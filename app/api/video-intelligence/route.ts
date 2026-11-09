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

import {NextRequest, NextResponse} from 'next/server';
import {analyzeVideoBuffer, flattenVideoAnnotations} from '../../lib/videoIntelligence';
import {
  isSupportedLanguage,
  MAX_UPLOAD_BYTES,
  toClientErrorDetails,
  validateVideoUpload,
} from '../../lib/validation';

/** Allowance for multipart boundaries and the text fields sent alongside the video. */
const FORM_OVERHEAD_BYTES = 1024 * 1024;

/**
 * Analyzes an uploaded video file using the Google Cloud Video Intelligence API.
 */
export async function POST(req: NextRequest) {
  try {
    // We only accept FormData with a file
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Content type must be multipart/form-data' },
        { status: 400 }
      );
    }

    const contentLength = Number(req.headers.get('content-length') || '0');
    if (contentLength > MAX_UPLOAD_BYTES + FORM_OVERHEAD_BYTES) {
      return NextResponse.json(
        { error: 'The request exceeds the maximum upload size.' },
        { status: 413 }
      );
    }

    const formData = await req.formData();
    const fileEntry = formData.get('file');
    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: 'Missing file upload' },
        { status: 400 }
      );
    }

    const uploadError = validateVideoUpload(fileEntry);
    if (uploadError) {
      return NextResponse.json({ error: uploadError }, { status: 400 });
    }

    const languageCode = formData.get('languageCode')?.toString() || 'en-US';
    if (!isSupportedLanguage(languageCode)) {
      return NextResponse.json({ error: 'Unsupported language.' }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await fileEntry.arrayBuffer());
    const operationResult = await analyzeVideoBuffer(fileBuffer, languageCode);
    const flattenedEvents = flattenVideoAnnotations(operationResult.annotationResults || []);

    return NextResponse.json(flattenedEvents);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Error analyzing video.',
        details: toClientErrorDetails('Error analyzing video', error),
      },
      { status: 500 }
    );
  }
}
