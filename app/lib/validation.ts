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

/**
 * Server-side input validation shared by the API routes and Server Actions.
 *
 * Every value that ends up in a Google Cloud request (model name, endpoint location, media URI)
 * is checked against an allowlist here, so that callers cannot redirect requests or read
 * resources the service account has access to.
 */

import {LANGUAGES, SUPPORTED_MODELS, VOICES, type ModelType} from './constants';

/**
 * Maximum accepted upload size. Cloud Run rejects HTTP/1 request bodies above 32 MiB, so larger
 * files would fail in a deployed service anyway.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** Hosts accepted for YouTube video links. */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
]);

/** Vertex AI locations look like `global`, `us-central1` or `europe-west4`. */
const VERTEX_LOCATION_PATTERN = /^(global|[a-z]+-[a-z]+[0-9]+)$/;

/** Default Vertex AI location, required by preview models such as Gemini 3.1 Pro Preview. */
const DEFAULT_VERTEX_LOCATION = 'global';

/**
 * Checks that a value is one of the supported Gemini models.
 *
 * @param value - The untrusted model identifier.
 * @return True if the model is supported.
 */
export function isSupportedModel(value: unknown): value is ModelType {
  return typeof value === 'string' && SUPPORTED_MODELS.includes(value as ModelType);
}

/**
 * Checks that a value is one of the available Chirp 3 HD voice names.
 *
 * @param value - The untrusted voice name.
 * @return True if the voice is available.
 */
export function isSupportedVoice(value: unknown): value is string {
  return typeof value === 'string' && VOICES.some(voice => voice.name === value);
}

/**
 * Checks that a value is one of the supported BCP-47 language codes.
 *
 * @param value - The untrusted language code.
 * @return True if the language is supported.
 */
export function isSupportedLanguage(value: unknown): value is string {
  return typeof value === 'string' && LANGUAGES.some(language => language.code === value);
}

/**
 * Checks that a value is an https YouTube link. Anything else (for example `gs://` URIs) is
 * rejected, because Gemini would otherwise read it with the service account's permissions.
 *
 * @param value - The untrusted URL.
 * @return True if the URL points to YouTube over https.
 */
export function isYoutubeUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && YOUTUBE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Returns the Vertex AI location from the server configuration.
 *
 * The location becomes part of the API hostname, so it is never taken from a request and is
 * validated even though it comes from the operator's configuration.
 *
 * @return The configured location, or `global` if it is unset.
 * @throws Error if the configured location is malformed.
 */
export function getVertexLocation(): string {
  const configured = process.env.REGION;
  if (!configured || configured === 'undefined') return DEFAULT_VERTEX_LOCATION;
  if (!VERTEX_LOCATION_PATTERN.test(configured)) {
    throw new Error('REGION is not a valid Vertex AI location. Please check configuration.env.');
  }
  return configured;
}

/**
 * Validates an uploaded video before it is buffered and sent to Google Cloud.
 *
 * @param file - The uploaded file.
 * @return An error message, or null if the file is acceptable.
 */
export function validateVideoUpload(file: File): string | null {
  if (!file.type.startsWith('video/')) return 'Only video files are supported.';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `The video exceeds the maximum upload size of ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`;
  }
  return null;
}

/**
 * Logs an error on the server and returns details that are safe to send to the browser.
 *
 * Full error messages from the Google Cloud SDKs can contain project, bucket or account
 * details, so they are only returned during local development.
 *
 * @param context - Short description of the failed operation, used for the server log.
 * @param error - The caught error.
 * @return The error details for the response body, or undefined outside development.
 */
export function toClientErrorDetails(context: string, error: unknown): string | undefined {
  console.error(`${context}:`, error);
  if (process.env.NODE_ENV !== 'development') return undefined;
  return error instanceof Error ? error.message : String(error);
}
