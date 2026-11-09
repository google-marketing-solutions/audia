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

const DB_NAME = 'video-analyzer-db';
const DB_VERSION = 2;
const STORE_NAME = 'video-analyzer-store';
const VIDEO_KEY = 'last-video';
const ANALYSIS_KEY = 'last-analysis';
const AUDIO_KEY = 'last-audio';
const YOUTUBE_URL_KEY = 'last-youtube-url';

interface StoredData<T> {
  id: string;
  data: T;
}

/**
 * Opens the IndexedDB instance, upgrading the schema if necessary.
 *
 * @return A promise that resolves to the IDBDatabase instance.
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Error opening IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Saves generic data to IndexedDB under the specified key.
 *
 * @param key - The unique identifier for the data.
 * @param data - The payload to store.
 * @return A promise that resolves when the transaction completes.
 */
async function saveData<T>(key: string, data: T): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const storedData: StoredData<T> = { id: key, data };
  store.put(storedData);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      console.log(`Data saved to IndexedDB with key: ${key}`);
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      console.error('Error saving data:', transaction.error);
      db.close();
      reject(transaction.error);
    };
  });
}

/**
 * Retrieves generic data from IndexedDB by key.
 *
 * @param key - The unique identifier for the data.
 * @return A promise that resolves to the data or null if not found.
 */
async function loadData(key: string): Promise<unknown> {
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, 'readonly');
  const store = transaction.objectStore(STORE_NAME);
  const request = store.get(key);

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const result: StoredData<unknown> | undefined = request.result;
      db.close();
      if (result) {
        console.log(`Data loaded from IndexedDB with key: ${key}`);
        resolve(result.data);
      } else {
        console.log(`No data found in IndexedDB for key: ${key}`);
        resolve(null);
      }
    };
    request.onerror = () => {
      console.error('Error loading data:', request.error);
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Clears data from IndexedDB for the specified key.
 *
 * @param key - The unique identifier to remove.
 * @return A promise that resolves when the deletion completes.
 */
async function clearData(key: string): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  store.delete(key);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      console.log(`Data cleared from IndexedDB for key: ${key}`);
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      console.error('Error clearing data:', transaction.error);
      db.close();
      reject(transaction.error);
    };
  });
}

/**
 * Saves the video file to IndexedDB.
 * @param file - The video file to save.
 * @return A promise that resolves when the save is complete.
 */
export function saveVideo(file: File) { return saveData<File>(VIDEO_KEY, file); }

/**
 * Loads the video file from IndexedDB.
 * @return A promise that resolves to the video file, or null if not found.
 */
export async function loadVideo(): Promise<File | null> { return (await loadData(VIDEO_KEY)) as File | null; }

/**
 * Clears the video file from IndexedDB.
 * @return A promise that resolves when the deletion is complete.
 */
export function clearVideo() { return clearData(VIDEO_KEY); }

/**
 * Saves the analysis results to IndexedDB.
 * @param analysis - The analysis data payload to save.
 * @return A promise that resolves when the save is complete.
 */
export function saveAnalysis(analysis: unknown) { return saveData<unknown>(ANALYSIS_KEY, analysis); }

/**
 * Loads the analysis results from IndexedDB.
 * @return A promise that resolves to the analysis data, or null if not found.
 */
export function loadAnalysis() { return loadData(ANALYSIS_KEY); }

/**
 * Clears the analysis results from IndexedDB.
 * @return A promise that resolves when the deletion is complete.
 */
export function clearAnalysis() { return clearData(ANALYSIS_KEY); }

/**
 * Saves the generated audio blob to IndexedDB.
 * @param audio - The audio blob to save.
 * @return A promise that resolves when the save is complete.
 */
export function saveAudio(audio: Blob) { return saveData<Blob>(AUDIO_KEY, audio); }

/**
 * Loads the generated audio blob from IndexedDB.
 * @return A promise that resolves to the audio blob, or null if not found.
 */
export async function loadAudio(): Promise<Blob | null> { return (await loadData(AUDIO_KEY)) as Blob | null; }

/**
 * Clears the generated audio blob from IndexedDB.
 * @return A promise that resolves when the deletion is complete.
 */
export function clearAudio() { return clearData(AUDIO_KEY); }

/**
 * Saves the YouTube URL to IndexedDB.
 * @param url - The YouTube URL to save.
 * @return A promise that resolves when the save is complete.
 */
export function saveYoutubeUrl(url: string) { return saveData<string>(YOUTUBE_URL_KEY, url); }

/**
 * Loads the YouTube URL from IndexedDB.
 * @return A promise that resolves to the YouTube URL, or null if not found.
 */
export async function loadYoutubeUrl(): Promise<string | null> { return (await loadData(YOUTUBE_URL_KEY)) as string | null; }

/**
 * Clears the YouTube URL from IndexedDB.
 * @return A promise that resolves when the deletion is complete.
 */
export function clearYoutubeUrl() { return clearData(YOUTUBE_URL_KEY); }

