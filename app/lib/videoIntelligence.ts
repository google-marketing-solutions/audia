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

import {v1, protos} from '@google-cloud/video-intelligence';
import {Storage} from '@google-cloud/storage';
import {GoogleGenAI, Type} from '@google/genai';
import {randomUUID} from 'crypto';
import fs from 'fs';
import path from 'path';
import {getVertexLocation} from './validation';

/** Type alias for Google Cloud Video Intelligence annotation results. */
export type IVideoAnnotationResults =
  protos.google.cloud.videointelligence.v1.IVideoAnnotationResults;

const videoIntelligenceServiceClient = new v1.VideoIntelligenceServiceClient();
const storage = new Storage();

/** Folder in the bucket that holds videos while they are being annotated. */
const UPLOAD_FOLDER = 'video-intelligence';

/**
 * Uploads a video buffer to Cloud Storage and runs Video Intelligence annotations.
 *
 * The uploaded object is always deleted again, even if the annotation fails. The bucket
 * lifecycle rule created by setup.sh acts as a backstop if the process is killed.
 */
export async function analyzeVideoBuffer(
  fileBuffer: Buffer,
  languageCode = 'en-US'
) {
  // We upload to GCS because Video Intelligence API has a 50MB limit for base64 inline content
  const bucketName = finalBucketName;
  if (!bucketName) {
    throw new Error(
      'GCS_BUCKET_NAME is not configured. Please set GCS_BUCKET_NAME in configuration.env or environment variables.'
    );
  }
  const destinationPath = `${UPLOAD_FOLDER}/${randomUUID()}.mp4`;
  const gcsDestination = `gs://${bucketName}/${destinationPath}`;

  console.log(`Checking if bucket ${bucketName} exists...`);
  const bucket = storage.bucket(bucketName);
  const [exists] = await bucket.exists();
  if (!exists) {
    console.error(`Bucket ${bucketName} does not exist. Failing gracefully.`);
    throw new Error(
      `Configured GCS bucket gs://${bucketName} does not exist. Please create it or configure a valid bucket.`
    );
  }

  const uploadedFile = bucket.file(destinationPath);
  try {
    console.log(`Uploading to GCS ${gcsDestination}...`);
    await uploadedFile.save(fileBuffer, { resumable: false });

    console.log(`Calling Video Intelligence API for ${gcsDestination}...`);
    const request = {
      inputUri: gcsDestination,
      features: [
        'LABEL_DETECTION',
        'SHOT_CHANGE_DETECTION',
        'SPEECH_TRANSCRIPTION',
        'OBJECT_TRACKING',
        'PERSON_DETECTION',
        'TEXT_DETECTION',
      ] as unknown as protos.google.cloud.videointelligence.v1.Feature[],
      videoContext: {
        speechTranscriptionConfig: {
          languageCode, // Providing this acts as a hint when auto-identification is enabled
          enableAutomaticPunctuation: true,
          enableAutomaticLanguageIdentification: true,
          enableWordTimeOffsets: true,
        },
      },
    };

    const annotationResultTuple =
      await videoIntelligenceServiceClient.annotateVideo(request);
    const operation = annotationResultTuple[0];

    console.log(
      'Waiting for operation to complete (this may take a few minutes)...'
    );
    const [operationResult] = await operation.promise();

    const rawResults: IVideoAnnotationResults[] =
      operationResult.annotationResults || [];
    if (rawResults.length === 0) {
      throw new Error('No annotations returned.');
    }

    return operationResult;
  } finally {
    try {
      await uploadedFile.delete({ ignoreNotFound: true });
    } catch (e) {
      console.warn(`Failed to delete temporary upload ${gcsDestination}`, e);
    }
  }
}

/** Single flattened timeline event extracted from Video Intelligence annotations. */
export interface FlattenedEvent {
  timestamp: number;
  endTimestamp?: number;
  type: string;
  content: string;
}

/** Maximum silence (in seconds) between two words that still keeps them in the same spoken phrase. */
const SPEECH_PAUSE_SPLIT_SECONDS = 0.2;

/** Maximum duration (in seconds) of a single spoken phrase before it is split into a new one. */
const SPEECH_PHRASE_MAX_DURATION_SECONDS = 2.5;

/** Punctuation marks that terminate a spoken sentence. */
const SENTENCE_TERMINATOR_PATTERN = /[.!?]$/;

function formatTime(timeOffset?: protos.google.protobuf.IDuration | null) {
  if (!timeOffset) return 0;
  const seconds = Number(timeOffset.seconds || 0);
  const nanos = Number(timeOffset.nanos || 0);
  return seconds + nanos / 1e9;
}

interface TimedWord {
  word: string;
  start: number;
  end: number;
}

/**
 * Converts the raw word infos of a speech transcription into timed words.
 *
 * @param words - The raw word infos returned by the Video Intelligence API.
 * @return The words that carry actual content, with their start and end times in seconds.
 */
function toTimedWords(
  words?: protos.google.cloud.videointelligence.v1.IWordInfo[] | null
): TimedWord[] {
  if (!words) return [];

  return words
    .map(w => ({
      word: (w.word || '').trim(),
      start: formatTime(w.startTime),
      end: formatTime(w.endTime),
    }))
    .filter(w => w.word.length > 0);
}

/**
 * Decides whether a word starts a new spoken phrase instead of continuing the current one.
 *
 * @param phrase - The words already collected in the current phrase.
 * @param word - The word to append.
 * @return True if the word should start a new phrase.
 */
function startsNewPhrase(phrase: TimedWord[], word: TimedWord): boolean {
  const previous = phrase[phrase.length - 1];
  if (SENTENCE_TERMINATOR_PATTERN.test(previous.word)) return true;
  if (word.start - previous.end >= SPEECH_PAUSE_SPLIT_SECONDS) return true;

  return word.end - phrase[0].start > SPEECH_PHRASE_MAX_DURATION_SECONDS;
}

/**
 * Groups timed words into phrases separated by sentence punctuation, pauses or excessive duration.
 *
 * @param words - The timed words of a single transcription, in chronological order.
 * @return The words grouped into phrases.
 */
function groupWordsIntoPhrases(words: TimedWord[]): TimedWord[][] {
  return words.reduce<TimedWord[][]>((phrases, word) => {
    const current = phrases[phrases.length - 1];
    if (!current || startsNewPhrase(current, word)) return [...phrases, [word]];

    return [...phrases.slice(0, -1), [...current, word]];
  }, []);
}

/**
 * Converts a speech transcription into spoken text events that keep their position on the timeline.
 *
 * Without word level timings the whole transcript would collapse onto a single timestamp, which
 * places every spoken sentence in the first scene.
 *
 * @param transcription - A single speech transcription returned by the Video Intelligence API.
 * @return One event per spoken phrase, each covering the time range in which it is spoken.
 */
function toSpokenTextEvents(
  transcription: protos.google.cloud.videointelligence.v1.ISpeechTranscription
): FlattenedEvent[] {
  const alternative = transcription.alternatives?.[0];
  const timedWords = toTimedWords(alternative?.words);

  if (timedWords.length === 0) {
    const transcript = alternative?.transcript?.trim();
    return transcript ? [{ timestamp: 0, type: 'spoken text', content: transcript }] : [];
  }

  return groupWordsIntoPhrases(timedWords).map(phrase => ({
    timestamp: phrase[0].start,
    endTimestamp: phrase[phrase.length - 1].end,
    type: 'spoken text',
    content: phrase.map(w => w.word).join(' '),
  }));
}

function extractEvents<T>(
  items: T[] | null | undefined,
  type: string,
  extractContent: (item: T) => string | null | undefined,
  extractTimes: (
    item: T
  ) => Array<protos.google.protobuf.IDuration | null | undefined>
): FlattenedEvent[] {
  const events: FlattenedEvent[] = [];
  if (!items) return events;

  for (const item of items) {
    const content = extractContent(item);
    if (!content) continue;

    const times = extractTimes(item);
    for (const time of times) {
      events.push({
        timestamp: formatTime(time),
        type,
        content,
      });
    }
  }
  return events;
}

/**
 * Creates a "flat" description in the format of timestamp, type, content
 * from the raw IVideoAnnotationResults.
 */
export function flattenVideoAnnotations(
  results: IVideoAnnotationResults[]
): FlattenedEvent[] {
  const events: FlattenedEvent[] = [];

  for (const result of results) {
    // 1. Spoken Text (Speech Transcriptions)
    events.push(
      ...(result.speechTranscriptions || []).flatMap(toSpokenTextEvents)
    );

    // 2. Visual Text (Text Annotations)
    events.push(
      ...extractEvents(
        result.textAnnotations,
        'visual text',
        t => t.text,
        t => (t.segments ? t.segments.map(s => s.segment?.startTimeOffset) : [])
      )
    );

    // 3. Segment Labels
    events.push(
      ...extractEvents(
        result.segmentLabelAnnotations,
        'label (segment)',
        l => l.entity?.description || l.entity?.entityId,
        l => (l.segments ? l.segments.map(s => s.segment?.startTimeOffset) : [])
      )
    );

    // 4. Shot Labels
    events.push(
      ...extractEvents(
        result.shotLabelAnnotations,
        'label (shot)',
        l => l.entity?.description || l.entity?.entityId,
        l => (l.segments ? l.segments.map(s => s.segment?.startTimeOffset) : [])
      )
    );

    // 5. Objects
    events.push(
      ...extractEvents(
        result.objectAnnotations,
        'object',
        o => o.entity?.description,
        o => (o.segment ? [o.segment.startTimeOffset] : [])
      )
    );

    // 6. Persons
    events.push(
      ...extractEvents(
        result.personDetectionAnnotations,
        'person',
        () => 'Person detected',
        p => (p.tracks ? p.tracks.map(t => t.segment?.startTimeOffset) : [])
      )
    );

    // 8. Shot Changes
    events.push(
      ...extractEvents(
        result.shotAnnotations,
        'shot change',
        () => 'Shot changed',
        s => [s.startTimeOffset]
      )
    );
  }

  // Sort chronologically by timestamp
  events.sort((a, b) => a.timestamp - b.timestamp);

  return events;
}

let gcpProjectId = process.env.GCP_PROJECT_ID;
let gcsBucketName = process.env.GCS_BUCKET_NAME;

try {
  const envPath = path.join(process.cwd(), 'configuration.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const projectMatch = envContent.match(/^GCP_PROJECT_ID=(.*)$/m);
    if (projectMatch && projectMatch[1]) {
      gcpProjectId = projectMatch[1].trim().replace(/^["']|["']$/g, '');
    }
    const bucketMatch = envContent.match(/^GCS_BUCKET_NAME=(.*)$/m);
    if (bucketMatch && bucketMatch[1]) {
      gcsBucketName = bucketMatch[1].trim().replace(/^["']|["']$/g, '');
    }
  }
} catch {
  console.warn('Could not read configuration.env');
}

const finalProject =
  gcpProjectId && gcpProjectId !== 'undefined' ? gcpProjectId : '';
const finalBucketName =
  gcsBucketName && gcsBucketName !== 'undefined' ? gcsBucketName : '';

const DEFAULT_PROMPT_TEMPLATE = `
You are an expert video analysis editor.
I am providing you with a flattened JSON timeline of video analysis events (which includes spoken text, visual text, labels, and objects).
Your task is to correct any typos or misclassifications in the "content" field of these events.

IMPORTANT RULES:
1. DO NOT change the "timestamp" or "endTimestamp" fields under ANY circumstances.
2. DO NOT change the "type" field.
3. Keep the JSON structure exactly the same, as an array of objects. Return exactly as many events as you received, in the same order, and never merge or drop events.
4. Only improve the "content" where obvious typos or misclassifications exist (e.g. fix spelling in spoken text, or correct a weird label).
5. Spoken text is split into consecutive phrases. Correct each phrase on its own and keep its words inside it, so the wording stays aligned with its time range.

Here are the events:
{{EVENTS_JSON}}
`;

/**
 * Enhances the flattened video analysis using Gemini.
 * It corrects typos and misclassifications but preserves timestamps and types.
 *
 * The Vertex AI location is read from the validated server configuration only.
 */
export async function enhanceVideoAnalysis(
  events: FlattenedEvent[],
  model: string,
  promptTemplate: string = DEFAULT_PROMPT_TEMPLATE
): Promise<FlattenedEvent[]> {
  if (!finalProject) {
    throw new Error(
      'GCP_PROJECT_ID is not configured. Please set GCP_PROJECT_ID in configuration.env or environment variables.'
    );
  }

  const aiClient = new GoogleGenAI({
    vertexai: true,
    project: finalProject,
    location: getVertexLocation(),
  });

  const eventsJson = JSON.stringify(events, null, 2);
  const prompt = promptTemplate.replace('{{EVENTS_JSON}}', eventsJson);

  const response = await aiClient.models.generateContent({
    model,
    contents: prompt,
    config: {
      thinkingConfig: { includeThoughts: false },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            timestamp: { type: Type.NUMBER },
            endTimestamp: { type: Type.NUMBER },
            type: { type: Type.STRING },
            content: { type: Type.STRING },
          },
          required: ['timestamp', 'type', 'content'],
        },
      },
    },
  });

  const text = response.text || '';

  try {
    const enhancedEvents = JSON.parse(text);
    return enhancedEvents;
  } catch {
    console.error('Failed to parse Gemini response', text);
    throw new Error('Gemini did not return valid JSON');
  }
}
