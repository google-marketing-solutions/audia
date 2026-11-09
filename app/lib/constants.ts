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
 * The default prompt template used for video analysis scene generation.
 */
export const DEFAULT_PROMPT = `Chapterize the video content into chronological scenes with short durations (e.g., a single spoken sentence or a distinct physical action).

Strictly adhere to these rules for each scene:
1. Objective Visual Description: Describe essential physical actions, body language, setting changes, and visual cues objectively without making subjective assumptions.
2. Dialogue & Audio Separation: Distinctly capture what is spoken versus what is only presented visually. Note any periods of dialogue silence where voiceover descriptions can fit.
3. Critical On-Screen Text (OCR): Exactly transcribe all visible text, including logos, discount percentages, promo codes, URLs, disclaimers, and Call-to-Action (CTA) buttons. Specify when text appears on screen.
4. Accuracy: Do not hallucinate or assume details not explicitly present in the video timeline.`;

/**
 * The default maximum synchronization offset (in seconds) allowed for aligning audio summary pacing with original timeline events.
 */
export const DEFAULT_MAX_SYNC_OFFSET = 2.0;

/**
 * Volume (0-1) the original video is lowered to while the generated audio description plays,
 * so that the description stays intelligible over the original soundtrack.
 */
export const SYNC_ORIGINAL_VIDEO_VOLUME = 0.2;

/**
 * Version shown next to the logo. Injected from package.json at build time so that the badge
 * always matches the deployed release.
 */
export const APP_VERSION = process.env.APP_VERSION || '0.0.0';

/**
 * Subtitle shown underneath the product name in the header.
 */
export const APP_TAGLINE = 'AI-Powered Video Accessibility';

/**
 * The default prompt template used for generating the audio description script.
 */
export const DEFAULT_AUDIO_SUMMARY_PROMPT = `Generate an accessible Audio Description (AD) script tailored for Blind and Low Vision (BLV) users.

CRITICAL ACCESSIBILITY RULES:
1. Never Talk Over Dialogue: Do NOT describe or repeat information that is already spoken audibly in the video. Focus exclusively on narrating visual-only elements during natural dialogue pauses.
2. Prioritize Essential Visual Context:
   - High Priority: Exactly read aloud any on-screen text not spoken in the audio (discount codes, prices, URLs, CTA buttons, legal disclaimers).
   - Medium Priority: Describe significant physical actions, scene transitions, and who is performing the action.
   - Low Priority: Describe setting details and facial expressions/body language.
3. Direct, Active Language: Use concise, vivid, active-voice phrasing. NEVER use filler introductions such as "We see", "The video shows", "Here is", or "A scene of".
4. Synchronization & Flow: Align speech with the video's timeline events within a maximum synchronization offset of {{MAX_SYNC_OFFSET}} seconds. Do not include bullet points, timestamps, or song lyrics in the generated script.`;

/** Supported Gemini model identifiers. */
export type ModelType =
  | 'gemini-3.1-pro-preview'
  | 'gemini-3.8-flash'
  | 'gemini-3.5-flash';

/** All Gemini models the backend accepts. Requests for any other model are rejected. */
export const SUPPORTED_MODELS: readonly ModelType[] = [
  'gemini-3.1-pro-preview',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
];

/** Default Gemini model used for analysis and summary generation. */
export const DEFAULT_MODEL: ModelType = 'gemini-3.1-pro-preview';
/** Default Cloud Text-to-Speech Chirp 3 HD voice name. */
export const DEFAULT_VOICE = 'Algenib';
/** Default BCP-47 language code for analysis and speech synthesis. */
export const DEFAULT_LANGUAGE = 'en-US';
/** Default speaking rate multiplier for speech synthesis. */
export const DEFAULT_SPEAKING_RATE = 1.1;
/** Default target speaking rate in words per minute. */
export const DEFAULT_WORDS_PER_MINUTE = 200;

/** Available Cloud Text-to-Speech Chirp 3 HD voices. */
export const VOICES = [
  {
    name: 'Achernar',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-achernar.wav',
  },
  {
    name: 'Achird',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-achird.wav',
  },
  {
    name: 'Algenib',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-algenib.wav',
  },
  {
    name: 'Algieba',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-algieba.wav',
  },
  {
    name: 'Alnilam',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-alnilam.wav',
  },
  {
    name: 'Aoede',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-aoeda.wav',
  },
  {
    name: 'Autonoe',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-autonoe.wav',
  },
  {
    name: 'Callirrhoe',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-callirrhoe.wav',
  },
  {
    name: 'Charon',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-charon.wav',
  },
  {
    name: 'Despina',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-despina.wav',
  },
  {
    name: 'Enceladus',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-enceladus.wav',
  },
  {
    name: 'Erinome',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-erinome.wav',
  },
  {
    name: 'Fenrir',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-fenrir.wav',
  },
  {
    name: 'Gacrux',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-gacrux.wav',
  },
  {
    name: 'Iapetus',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-iapetus.wav',
  },
  {
    name: 'Kore',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-kore.wav',
  },
  {
    name: 'Laomedeia',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-laomedeia.wav',
  },
  {
    name: 'Leda',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-leda.wav',
  },
  {
    name: 'Orus',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-orus.wav',
  },
  {
    name: 'Pulcherrima',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-pulcherrima.wav',
  },
  {
    name: 'Puck',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-puck.wav',
  },
  {
    name: 'Rasalgethi',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-rasalgethi.wav',
  },
  {
    name: 'Sadachbia',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-sadachbia.wav',
  },
  {
    name: 'Sadaltager',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-sadaltager.wav',
  },
  {
    name: 'Schedar',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-schedar.wav',
  },
  {
    name: 'Sulafat',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-sulafat.wav',
  },
  {
    name: 'Umbriel',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-umbriel.wav',
  },
  {
    name: 'Vindemiatrix',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-vindemiatrix.wav',
  },
  {
    name: 'Zephyr',
    gender: 'Female',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-zephyr.wav',
  },
  {
    name: 'Zubenelgenubi',
    gender: 'Male',
    url: 'https://cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-zubenelgenubi.wav',
  },
];

/** Supported output languages for audio descriptions. */
export const LANGUAGES = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'es-ES', name: 'Spanish (Spain)' },
  { code: 'fr-FR', name: 'French (France)' },
  { code: 'de-DE', name: 'German (Germany)' },
];
