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

import {TextToSpeechClient} from '@google-cloud/text-to-speech';
import {NextRequest, NextResponse} from 'next/server';
import {calculateTTSCost} from '@/app/lib/server/pricing';
import {DEFAULT_LANGUAGE, DEFAULT_SPEAKING_RATE, DEFAULT_VOICE} from '@/app/lib/constants';
import {isSupportedLanguage, isSupportedVoice, toClientErrorDetails} from '@/app/lib/validation';

const client = new TextToSpeechClient();

/**
 * Handles POST requests to synthesize speech from text using the Google Cloud Text-to-Speech API.
 *
 * @param req - The incoming NextRequest containing the JSON body with text and voice params.
 * @return A NextResponse containing the generated audio buffer or an error message.
 */
export async function synthesizeSpeechHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const text: unknown = body.text;
    const voiceName: unknown = body.voice || DEFAULT_VOICE; // e.g., "Algenib"
    const language: unknown = body.language || DEFAULT_LANGUAGE;
    const speakingRate: number = Number(body.speakingRate) || DEFAULT_SPEAKING_RATE;

    if (typeof text !== 'string' || !text) {
      return NextResponse.json({ error: 'Text is required.' }, { status: 400 });
    }
    if (!isSupportedVoice(voiceName)) {
      return NextResponse.json({ error: 'Unsupported voice.' }, { status: 400 });
    }
    if (!isSupportedLanguage(language)) {
      return NextResponse.json({ error: 'Unsupported language.' }, { status: 400 });
    }

    const request = {
      input: { text },
      voice: {
        languageCode: language,
        name: `${language}-Chirp3-HD-${voiceName}`, // Map short name to full Vertex AI voice name with language
      },
      audioConfig: {
        audioEncoding: 'LINEAR16' as const,
        speakingRate,
      },
    };

    const [response] = await client.synthesizeSpeech(request);
    const audioContent = response.audioContent;

    if (!audioContent) {
      throw new Error('No audio content received from Vertex AI TTS.');
    }

    // audioContent can be a string (base64) or Uint8Array
    // We need to return it as a Blob or Buffer
    let audioBuffer: Buffer;
    if (typeof audioContent === 'string') {
      audioBuffer = Buffer.from(audioContent, 'base64');
    } else {
      audioBuffer = Buffer.from(audioContent);
    }

    const textCharCount = text.length;
    const estimatedCost = calculateTTSCost(text);

    return new NextResponse(new Blob([new Uint8Array(audioBuffer)]), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length.toString(),
        'X-TTS-Characters': textCharCount.toString(),
        'X-TTS-Estimated-Cost': estimatedCost.toString()
      },
    });

  } catch (error) {
    return NextResponse.json(
      {
        error: 'Error generating audio.',
        details: toClientErrorDetails('Error generating audio', error),
      },
      { status: 500 }
    );
  }
}

export { synthesizeSpeechHandler as POST };
