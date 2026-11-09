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

"use server";

import {GoogleGenAI} from '@google/genai';
import {calculateGeminiCost} from '@/app/lib/server/pricing';
import {getVertexLocation, isSupportedModel, toClientErrorDetails} from '@/app/lib/validation';

/**
 * Generates content using Vertex AI Gemini and returns the text, usage metadata, and estimated cost.
 */
export async function generateContentAction(prompt: string, model: string, schema?: Record<string, unknown>) {
  if (!isSupportedModel(model)) {
    throw new Error('Unsupported model.');
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('A prompt is required.');
  }

  try {
    const project = process.env.GCP_PROJECT_ID;
    if (!project || project === 'undefined') {
      throw new Error(
        'GCP_PROJECT_ID is not configured. Please set GCP_PROJECT_ID in configuration.env or environment variables.'
      );
    }
    const ai = new GoogleGenAI({
      vertexai: true,
      project,
      location: getVertexLocation(),
    });

    const config: Record<string, unknown> = {};
    if (schema) {
      config.responseMimeType = "application/json";
      config.responseSchema = schema;
    }

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      ...(Object.keys(config).length > 0 && { config }),
    });

    const estimatedCost = calculateGeminiCost(response);

    return {
      text: response.text,
      usageMetadata: response.usageMetadata,
      estimatedCost,
    };
  } catch (error) {
    const details = toClientErrorDetails('Error in generateContentAction', error);
    throw new Error(details ?? 'Error generating content. Please check the server logs.');
  }
}
