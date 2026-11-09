/**
 * @license
 * Copyright 2026 Google LLC.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {calculateGeminiCost} from '@/app/lib/server/pricing';
import {GoogleGenAI, MediaResolution, Type} from '@google/genai';
import {NextRequest, NextResponse} from 'next/server';
import {analyzeVideoBuffer, flattenVideoAnnotations, enhanceVideoAnalysis} from '@/app/lib/videoIntelligence';
import {DEFAULT_MODEL} from '@/app/lib/constants';
import {
  getVertexLocation,
  isSupportedModel,
  isYoutubeUrl,
  MAX_UPLOAD_BYTES,
  toClientErrorDetails,
  validateVideoUpload,
} from '@/app/lib/validation';

/** Allowance for multipart boundaries and the text fields sent alongside the video. */
const FORM_OVERHEAD_BYTES = 1024 * 1024;

/**
 * Handles POST requests to analyze a video or YouTube URL using the Google GenAI SDK.
 *
 * @param req - The incoming NextRequest containing the form data.
 * @return A NextResponse containing the parsed analysis.
 */
export async function analyzeVideoHandler(req: NextRequest) {
  console.log('Received request to /api/analyze');

  const contentLength = Number(req.headers.get('content-length') || '0');
  if (contentLength > MAX_UPLOAD_BYTES + FORM_OVERHEAD_BYTES) {
    return NextResponse.json(
      { error: 'The request exceeds the maximum upload size.' },
      { status: 413 }
    );
  }

  try {
    const data = await req.formData();
    const fileEntry = data.get('file');
    const file = fileEntry instanceof File ? fileEntry : null;
    const youtubeUrlEntry = data.get('youtubeUrl');
    const youtubeUrl = typeof youtubeUrlEntry === 'string' ? youtubeUrlEntry.trim() : '';
    const promptEntry = data.get('prompt');
    const prompt = typeof promptEntry === 'string' ? promptEntry : '';
    const model = data.get('model') || DEFAULT_MODEL;

    if (!isSupportedModel(model)) {
      return NextResponse.json({ error: 'Unsupported model.' }, { status: 400 });
    }

    console.log(
      `Request details: hasFile=${Boolean(file)}, fileSize=${file?.size ?? 0}, hasYoutubeUrl=${Boolean(youtubeUrl)}, model=${model}`
    );

    let contents;

    if (youtubeUrl) {
      if (!isYoutubeUrl(youtubeUrl)) {
        return NextResponse.json(
          { error: 'Only https YouTube links are supported.' },
          { status: 400 }
        );
      }
      console.log('Processing YouTube URL...');
      const videoPart = {
        fileData: {
          fileUri: youtubeUrl,
          mimeType: 'video/mp4',
        },
      };
      const textPart = { text: prompt };
      contents = [{ role: 'user', parts: [videoPart, textPart] }];
    } else if (file) {
      const uploadError = validateVideoUpload(file);
      if (uploadError) {
        return NextResponse.json({ error: uploadError }, { status: 400 });
      }
      console.log('Processing uploaded file through Video Intelligence...');
      try {
        const bytes = await file.arrayBuffer();
        const videoBuffer = Buffer.from(bytes);

        console.log('Running Video Intelligence API...');
        const operationResult = await analyzeVideoBuffer(videoBuffer, 'en-US');
        const flattenedEvents = flattenVideoAnnotations(operationResult.annotationResults || []);

        console.log('Enhancing video analysis...');
        const enhancedEvents = await enhanceVideoAnalysis(flattenedEvents, model);
        const eventsJsonText = JSON.stringify(enhancedEvents, null, 2);

        const finalPrompt = `
Here is a timeline of events extracted from a video:
${eventsJsonText}

Each event has a "timestamp" (start time in seconds) and, for spoken text, an "endTimestamp" (end time in seconds).
Assign every event to the scene whose time range it overlaps. A "spoken text" event belongs to the scene that covers its timestamp range, so the spokenText of a scene must contain exactly the phrases spoken between its start and end, and nothing that is spoken in another scene. Never put the whole transcript into the first scene, and leave spokenText empty for scenes in which nobody speaks.

Based on this timeline, follow the instructions below to assemble coherent scenes.

Instructions:
${prompt}
`;
        contents = [{ role: 'user', parts: [{ text: finalPrompt }] }];
        console.log('File processed successfully with Video Intelligence pipeline.');
      } catch (error) {
        return NextResponse.json(
          {
            error: 'Error processing uploaded file.',
            details: toClientErrorDetails('Error processing uploaded file with Video Intelligence', error),
          },
          { status: 500 }
        );
      }
    } else {
      console.error('Validation failed: No file or YouTube URL provided.');
      return NextResponse.json(
        { error: 'A file or YouTube URL is required.' },
        { status: 400 }
      );
    }

    try {
      console.log('Calling Gemini API to assemble scenes...');
      const gcpProjectId = process.env.GCP_PROJECT_ID;

      // Require explicit GCP project ID configuration
      if (!gcpProjectId || gcpProjectId === 'undefined') {
        throw new Error(
          'GCP_PROJECT_ID is not configured. Please set GCP_PROJECT_ID in configuration.env or environment variables.'
        );
      }

      const ai = new GoogleGenAI({
        vertexai: true,
        project: gcpProjectId,
        location: getVertexLocation(),
      });

      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          thinkingConfig: { includeThoughts: false },
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    start: {
                      type: Type.NUMBER,
                      description: 'The start time of the scene in seconds.',
                    },
                    end: {
                      type: Type.NUMBER,
                      description: 'The end time of the scene in seconds.',
                    },
                    description: {
                      type: Type.STRING,
                      description:
                        'A detailed description of the visual events in the scene.',
                    },
                    visibleText: {
                      type: Type.STRING,
                      description:
                        'Any text visible on the screen during this scene (e.g., logos, subtitles).',
                    },
                    spokenText: {
                      type: Type.STRING,
                      description:
                        'A transcript of the spoken words in this scene.',
                    },
                  },
                  required: [
                    'start',
                    'end',
                    'description',
                    'visibleText',
                    'spokenText',
                  ],
                },
              },
            },
            required: ['scenes'],
          },
        },
      });

      console.log('Gemini API call successful. Usage:', response.usageMetadata);

      const estimatedCost = calculateGeminiCost(response);

      let parsedAnalysis;
      try {
        parsedAnalysis = JSON.parse(response.text || '');
      } catch {
        parsedAnalysis = response.text;
      }

      return NextResponse.json({
        analysis: parsedAnalysis,
        usageMetadata: response.usageMetadata,
        estimatedCost,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: 'Error during Gemini API call.',
          details: toClientErrorDetails('Error during Gemini API call', error),
        },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: 'An unexpected error occurred.',
        details: toClientErrorDetails('An unexpected error occurred', error),
      },
      { status: 500 }
    );
  }
}

export { analyzeVideoHandler as POST };
