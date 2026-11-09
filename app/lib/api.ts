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

import type {PricingConfig} from './server/pricing';

/**
 * API error payload returned by backend endpoints.
 */
export interface ApiError {
  message: string;
  details?: string;
}

/**
 * Response returned by the video analysis endpoint.
 */
export interface AnalyzeVideoResponse {
  analysis: unknown;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
    toolUsePromptTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  estimatedCost?: number;
}

/**
 * Calls the /api/text-to-speech route to generate audio from text.
 *
 * @param text - The text to synthesize into speech.
 * @param voice - The name of the voice to use.
 * @param language - The language code (e.g., 'en-US').
 * @param speakingRate - The speed of the synthesized speech.
 * @return A promise that resolves to a Blob containing the audio data.
 */
export async function generateSpeechApi(
  text: string,
  voice: string,
  language: string,
  speakingRate: number
): Promise<{ blob: Blob, characters: number, estimatedCost: number }> {
  const response = await fetch('/api/text-to-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, language, speakingRate }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw { message: errorData.error || 'Error generating audio.', details: errorData.details } as ApiError;
  }

  const characters = Number(response.headers.get('X-TTS-Characters') || '0');
  const estimatedCost = Number(response.headers.get('X-TTS-Estimated-Cost') || '0');
  const blob = await response.blob();

  return { blob, characters, estimatedCost };
}



/**
 * Calls the /api/analyze route.
 *
 * @param file - The video file to analyze, or null if using a YouTube URL.
 * @param youtubeUrl - The YouTube URL to analyze, or null if using a file.
 * @param prompt - The instruction prompt for the analysis.
 * @param model - The identifier of the AI model to use.
 * @param signal - Optional AbortSignal to cancel the fetch request.
 * @return A promise that resolves to an object containing the parsed analysis and usage metadata.
 */
export async function analyzeVideoApi(
  file: File | null,
  youtubeUrl: string | null,
  prompt: string,
  model: string,
  signal?: AbortSignal
): Promise<AnalyzeVideoResponse> {
  const formData = new FormData();
  if (file) formData.append("file", file);
  if (youtubeUrl) formData.append("youtubeUrl", youtubeUrl);
  formData.append("prompt", prompt);
  formData.append("model", model);

  const response = await fetch("/api/analyze", {
    method: "POST",
    body: formData,
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw { message: errorData.error || "An error occurred.", details: errorData.details } as ApiError;
  }

  const data = await response.json();
  return {
    analysis: typeof data.analysis === 'string' ? JSON.parse(data.analysis) : data.analysis,
    usageMetadata: data.usageMetadata,
    estimatedCost: data.estimatedCost
  };
}

/**
 * Fetches the backend pricing configuration.
 *
 * @return A promise resolving to the pricing config JSON object.
 */
export async function getPricingApi(): Promise<PricingConfig> {
  const response = await fetch("/api/pricing", {
    method: "GET",
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw { message: errorData.error || "Failed to fetch pricing config.", details: errorData.details } as ApiError;
  }

  return response.json();
}
