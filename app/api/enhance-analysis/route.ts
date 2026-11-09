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
import {enhanceVideoAnalysis} from '@/app/lib/videoIntelligence';
import {isSupportedModel, toClientErrorDetails} from '@/app/lib/validation';

/**
 * Enhances flattened video analysis events using Gemini.
 *
 * The Vertex AI location always comes from the server configuration and is never read from the
 * request, because it becomes part of the API hostname that receives the service account token.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!Array.isArray(body)) {
      return NextResponse.json({ error: 'Body must be an array of events' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const model = searchParams.get('model');

    if (!model) {
      return NextResponse.json({ error: 'Model query parameter is required' }, { status: 400 });
    }
    if (!isSupportedModel(model)) {
      return NextResponse.json({ error: 'Unsupported model.' }, { status: 400 });
    }

    const enhancedEvents = await enhanceVideoAnalysis(body, model);

    return NextResponse.json(enhancedEvents);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Error enhancing the video analysis.',
        details: toClientErrorDetails('Error in enhance-analysis', error),
      },
      { status: 500 }
    );
  }
}
