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

"use client";

import {AnimatePresence, motion} from "framer-motion";
import {useCallback, useEffect, useRef, useState} from "react";
import {
  Activity,
  Download,
  FileText,
  Maximize,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Trash2,
  Upload,
  Video,
  Volume2,
} from 'react-feather';
import ReactPlayer from 'react-player';
import {
  clearAnalysis,
  clearAudio,
  clearVideo,
  clearYoutubeUrl,
  loadAnalysis,
  loadAudio,
  loadVideo,
  loadYoutubeUrl,
  saveAnalysis,
  saveAudio,
  saveVideo,
  saveYoutubeUrl,
} from './db';

import {generateContentAction} from "./actions/gemini";
import {SettingsModal} from './components/SettingsModal';
import {analyzeVideoApi, generateSpeechApi} from './lib/api';
import {
  APP_TAGLINE,
  APP_VERSION,
  DEFAULT_AUDIO_SUMMARY_PROMPT,
  DEFAULT_LANGUAGE,
  DEFAULT_MODEL,
  DEFAULT_PROMPT,
  DEFAULT_SPEAKING_RATE,
  DEFAULT_VOICE,
  DEFAULT_WORDS_PER_MINUTE,
  DEFAULT_MAX_SYNC_OFFSET,
  LANGUAGES,
  SUPPORTED_MODELS,
  SYNC_ORIGINAL_VIDEO_VOLUME,
  VOICES,
  type ModelType,
} from './lib/constants';
import {cn} from './lib/utils';

/** Error message and optional developer details displayed in the UI. */
export interface ErrorState {
  message: string;
  details?: string;
}

/** Chronological video scene with visual and audio descriptions. */
export interface Scene {
  start: number;
  end: number;
  description: string;
  visibleText: string;
  spokenText: string;
}

/** Generated audio description script and synthesis parameters. */
export interface AudioTrack {
  description: string;
  voice?: string;
  language?: string;
  speakingRate?: number;
}

/** Complete video analysis result containing scenes and audio track metadata. */
export interface Analysis {
  scenes: Scene[];
  audio_track?: AudioTrack;
  summary?: AudioTrack;
}

/** Extended HTMLVideoElement interface supporting ReactPlayer methods. */
export interface VideoPlayerElement extends HTMLVideoElement {
  getDuration?: () => number;
  getCurrentTime?: () => number;
  seekTo?: (amount: number, type?: 'seconds' | 'fraction') => void;
  getInternalPlayer?: () => { unloadModule?: (module: string) => void } | null;
}

/** Token usage metadata returned by Vertex AI Gemini. */
export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cachedContentTokenCount?: number;
  toolUsePromptTokenCount?: number;
  thoughtsTokenCount?: number;
}

/** Cumulative session usage and cost metrics. */
export interface SessionCostData {
  totalPromptTokens: number;
  totalCandidatesTokens: number;
  totalCachedTokens: number;
  totalThoughtsTokens: number;
  ttsCharacters: number;
  geminiRuns: number;
  ttsRuns: number;
  totalEstimatedCost: number;
}

const INITIAL_SESSION_COSTData: SessionCostData = {
  totalPromptTokens: 0,
  totalCandidatesTokens: 0,
  totalCachedTokens: 0,
  totalThoughtsTokens: 0,
  ttsCharacters: 0,
  geminiRuns: 0,
  ttsRuns: 0,
  totalEstimatedCost: 0
};

function getDurationPromptConstraint(videoDurationSeconds: number, targetWordsPerMinute: number) : string {
  const targetWordCount = Math.floor(videoDurationSeconds * (targetWordsPerMinute / 60));
  return `\n\nIMPORTANT: The audio track summary must be approximately ${Math.round(videoDurationSeconds)} seconds long to match the video length.
  Keep the summary under ${targetWordCount} words. Do NOT speak over existing dialogue; insert concise voiceover descriptions only during natural pauses in speech.`;
}

interface TypedReactPlayerProps {
  ref?: React.RefObject<VideoPlayerElement | null>;
  src?: string;
  playing?: boolean;
  controls?: boolean;
  width?: string | number;
  height?: string | number;
  volume?: number;
  config?: {
    youtube?: {
      playerVars?: {
        cc_load_policy?: number;
        iv_load_policy?: number;
      };
    };
  };
  progressInterval?: number;
  onReady?: () => void;
  onPlay?: () => void;
  onVolumeChange?: (event: unknown) => void;
  onDuration?: (duration: number) => void;
  onProgress?: (
    state: React.SyntheticEvent<HTMLVideoElement> | {playedSeconds: number},
  ) => void;
  onSeek?: (seconds: number) => void;
  onError?: () => void;
}

const TypedReactPlayer =
  ReactPlayer as unknown as React.ComponentType<TypedReactPlayerProps>;

/**
 * Main application component. Handled state, media loading, generated analysis and UI interactions.
 */
// tslint:disable-next-line:no-default-export
export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState<string>("");
  const [youtubeInput, setYoutubeInput] = useState<string>("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [audioSummaryPrompt, setAudioSummaryPrompt] = useState(DEFAULT_AUDIO_SUMMARY_PROMPT);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [activeScene, setActiveScene] = useState<number | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [highlightModelSettings, setHighlightModelSettings] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelType>(DEFAULT_MODEL);
  const [selectedVoice, setSelectedVoice] = useState(DEFAULT_VOICE);
  const [selectedLanguage, setSelectedLanguage] = useState(DEFAULT_LANGUAGE);
  const [speakingRate, setSpeakingRate] = useState(DEFAULT_SPEAKING_RATE);
  const [wordsPerMinute, setWordsPerMinute] = useState(DEFAULT_WORDS_PER_MINUTE);
  const [maxSyncOffset, setMaxSyncOffset] = useState(DEFAULT_MAX_SYNC_OFFSET);
  const [sessionCostData, setSessionCostData] = useState<SessionCostData>(INITIAL_SESSION_COSTData);
  const [playingScene, setPlayingScene] = useState<number | null>(null);
  const [isAudioLoading, setIsAudioLoading] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<VideoPlayerElement | null>(null);
  const sceneRefs = useRef<Array<HTMLDivElement | null>>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isSeeking = useRef(false);
  const seekTimeout = useRef<NodeJS.Timeout | null>(null);

  const [summaryAudioDuration] = useState<number | null>(null);

  const [summaryAudioUrl, setSummaryAudioUrl] = useState<string | null>(null);
  const [isSummaryAudioLoading, setIsSummaryAudioLoading] = useState(false);
  const [isSummaryTextLoading, setIsSummaryTextLoading] = useState(false);
  const [summaryInstructions, setSummaryInstructions] = useState("");
  const [summaryAudioError, setSummaryAudioError] = useState<string | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  const [playerVolume, setPlayerVolume] = useState<number>(1);
  const analysisContainerRef = useRef<HTMLDivElement>(null);

  const [isFullscreenPlaying, setIsFullscreenPlaying] = useState(false);
  const [syncPlaying, setSyncPlaying] = useState(true);
  const syncVideoRef = useRef<HTMLVideoElement | null>(null);
  const syncReactPlayerRef = useRef<VideoPlayerElement | null>(null);
  const syncAudioRef = useRef<HTMLAudioElement | null>(null);

  /**
   * Keeps the synchronized video element and lowers its volume as soon as it is mounted.
   * The element only exists while the fullscreen overlay is open and starts playing
   * immediately, so the volume has to be applied here rather than before opening it.
   *
   * @param element - The mounted video element, or null when it is unmounted.
   */
  const attachSyncVideo = useCallback((element: HTMLVideoElement | null) => {
    syncVideoRef.current = element;
    if (element) element.volume = SYNC_ORIGINAL_VIDEO_VOLUME;
  }, []);

  /**
   * Triggers the regeneration of the text summary based on the given prompt instructions.
   * @return A promise that resolves to the generated summary text, or null if it failed.
   */
  const regenerateTextSummary = useCallback(async (): Promise<string | null> => {
    if (!analysis) return null;

    setIsSummaryTextLoading(true);
    setSummaryAudioError(null);

    try {
      let finalPrompt = audioSummaryPrompt.replace('{{MAX_SYNC_OFFSET}}', maxSyncOffset.toString());
      let duration = videoDurationSeconds;
      if (!duration && playerRef.current) {
        duration = typeof playerRef.current.getDuration === 'function' ? playerRef.current.getDuration() : playerRef.current.duration;
      }
      console.log("resolved videoDurationSeconds", duration);
      if (typeof duration !== 'number' || duration <= 0) {
        throw new Error("Video duration must be a number greater than 0. Please play the video for a second so it can load.");
      }
      finalPrompt += getDurationPromptConstraint(duration, wordsPerMinute);

      finalPrompt += `\n\nIMPORTANT: Please provide the response in ${LANGUAGES.find(l => l.code === selectedLanguage)?.name || selectedLanguage}.`;

      if (summaryInstructions.trim()) {
        finalPrompt += `\n\nAdditional Instructions: ${summaryInstructions.trim()}`;
      }

      // Construct final prompt based on analysis scenes
      const scenesText = JSON.stringify(analysis.scenes, null, 2);
      const fullPrompt = `Based on the following video analysis, please generate an audio summary:\n\n${scenesText}\n\n${finalPrompt}`;

      console.log("Audio Summary final Prompt:", fullPrompt);

      const responseSchema = {
        type: "OBJECT",
        properties: {
          spoken_text: {
            type: "STRING",
            description: "The spoken text of the audio summary.",
          },
        },
        required: ["spoken_text"],
      };

      const response = await generateContentAction(fullPrompt, selectedModel, responseSchema);
      let generatedText = response.text || "";

      try {
        const parsed = JSON.parse(generatedText);
        if (parsed.spoken_text) {
          generatedText = parsed.spoken_text;
        }
      } catch (e) {
        console.warn("Failed to parse JSON response:", e);
      }

      if (response.usageMetadata) {
        setSessionCostData(prev => {
          const updated = {
            ...prev,
            totalPromptTokens: prev.totalPromptTokens + (response.usageMetadata?.promptTokenCount || 0),
            totalCandidatesTokens: prev.totalCandidatesTokens + (response.usageMetadata?.candidatesTokenCount || 0),
            totalCachedTokens: prev.totalCachedTokens + (response.usageMetadata?.cachedContentTokenCount || 0),
            totalThoughtsTokens: prev.totalThoughtsTokens + (response.usageMetadata?.thoughtsTokenCount || 0),
            totalEstimatedCost: prev.totalEstimatedCost + (response.estimatedCost || 0),
            geminiRuns: prev.geminiRuns + 1
          };
          localStorage.setItem("sessionCostData", JSON.stringify(updated));
          return updated;
        });
      }

      if (true) {
        setAnalysis((prev) => {
          if (!prev) return null;
          const newAnalysis = {
            ...prev,
            audio_track: {
              ...(prev.audio_track || { voice: selectedVoice, language: selectedLanguage, speakingRate }),
              description: generatedText
            }
          };
          saveAnalysis(newAnalysis);
          return newAnalysis;
        });

        setIsSummaryTextLoading(false);
        return generatedText;
      }
    } catch (err: unknown) {
      setSummaryAudioError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setIsSummaryTextLoading(false);
      return null;
    }
    return null;
  }, [analysis, audioSummaryPrompt, summaryInstructions, videoDurationSeconds, selectedVoice, speakingRate, wordsPerMinute, maxSyncOffset, selectedLanguage, selectedModel]);


  /**
   * Generates or regenerates an audio summary and saves the blob.
   * @param textOverride - Optional text to speak instead of the existing summary.
   * @return A promise that resolves when the generation is complete.
   */
  const generateSummaryAudio = useCallback(async (textOverride?: string) => {
    let textToSpeak = textOverride || analysis?.audio_track?.description;
    const isMissingText = !textToSpeak || textToSpeak.trim() === '';
    const isLanguageMismatch = analysis?.audio_track?.language && analysis.audio_track.language !== selectedLanguage;

    if (isMissingText) {
      const generated = await regenerateTextSummary();
      if (!generated) return;
      textToSpeak = generated;
    } else if (isLanguageMismatch) {
      const currentLangName = LANGUAGES.find(l => l.code === analysis?.audio_track?.language)?.name || analysis?.audio_track?.language;
      const targetLangName = LANGUAGES.find(l => l.code === selectedLanguage)?.name || selectedLanguage;

      const shouldRegenerate = window.confirm(`The current text summary is in ${currentLangName}, but you have selected ${targetLangName}. Would you like to automatically regenerate the text summary before generating the audio?`);

      if (shouldRegenerate) {
        const generated = await regenerateTextSummary();
        if (!generated) return;
        textToSpeak = generated;
      }
    }

    if (!textToSpeak) return;

    setIsSummaryAudioLoading(true);
    setSummaryAudioError(null);
    try {
      const { blob, characters, estimatedCost } = await generateSpeechApi(textToSpeak, selectedVoice, selectedLanguage, speakingRate);
      setSessionCostData(prev => {
        const updated = {
          ...prev,
          ttsCharacters: prev.ttsCharacters + characters,
          totalEstimatedCost: prev.totalEstimatedCost + estimatedCost,
          ttsRuns: prev.ttsRuns + 1
        };
        localStorage.setItem("sessionCostData", JSON.stringify(updated));
        return updated;
      });
      if (true) {
        saveAudio(blob);
        const url = URL.createObjectURL(blob);
        setSummaryAudioUrl(url);
        setAnalysis(prev => {
          if (!prev) return null;
          const newAnalysis = {
            ...prev,
            audio_track: {
              ...prev.audio_track,
              description: textToSpeak,
              voice: selectedVoice,
              language: selectedLanguage,
              speakingRate,
              wordsPerMinute,
              maxSyncOffset,
            }
          };
          saveAnalysis(newAnalysis);
          return newAnalysis;
        });
      }
    } catch (err: unknown) {
      setSummaryAudioError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsSummaryAudioLoading(false);
    }
  }, [analysis, selectedVoice, selectedLanguage, speakingRate, wordsPerMinute, maxSyncOffset, regenerateTextSummary]);

  /**
   * Handle regenerate click just directly invokes regenerateTextSummary without returning
   */
  const handleRegenerateClick = useCallback(async () => {
    await regenerateTextSummary();
  }, [regenerateTextSummary]);

  useEffect(() => {
    const loadLastSession = async () => {
      const savedPrompt = localStorage.getItem("userPrompt");
      if (savedPrompt) setPrompt(savedPrompt);
      const savedAudioSummaryPrompt = localStorage.getItem("userAudioSummaryPrompt");
      if (savedAudioSummaryPrompt) setAudioSummaryPrompt(savedAudioSummaryPrompt);
      const savedModel = localStorage.getItem("selectedModel");
      // Ignore models saved by earlier versions that the backend no longer accepts.
      if (savedModel && SUPPORTED_MODELS.includes(savedModel as ModelType)) setSelectedModel(savedModel as ModelType);
      const savedSpeakingRate = localStorage.getItem("speakingRate");
      if (savedSpeakingRate) setSpeakingRate(Number(savedSpeakingRate));
      const savedWordsPerMinute = localStorage.getItem("wordsPerMinute");
      if (savedWordsPerMinute) setWordsPerMinute(Number(savedWordsPerMinute));
      const savedMaxSyncOffset = localStorage.getItem("maxSyncOffset");
      if (savedMaxSyncOffset) setMaxSyncOffset(Number(savedMaxSyncOffset));

      const lastVideo = await loadVideo();
      if (lastVideo) {
        setFile(lastVideo);
        const url = URL.createObjectURL(lastVideo);
        setPreviewUrl(url);
      } else {
        const lastYoutubeUrl = await loadYoutubeUrl();
        if (lastYoutubeUrl) {
          setYoutubeUrl(lastYoutubeUrl);
          setYoutubeInput(lastYoutubeUrl);
        }
      }
      const lastAnalysis = await loadAnalysis();
      if (lastAnalysis) {
        const analysisData = lastAnalysis as Analysis;
        if (analysisData.summary && !analysisData.audio_track) {
          analysisData.audio_track = analysisData.summary;
          delete analysisData.summary;
        }
        setAnalysis(analysisData);
      }
      const lastAudio = await loadAudio();
      if (lastAudio) {
        const url = URL.createObjectURL(lastAudio);
        setSummaryAudioUrl(url);
      }
      const savedUsage = localStorage.getItem("sessionCostData");
      if (savedUsage) {
        try {
          setSessionCostData(JSON.parse(savedUsage));
        } catch (e) {
          console.error("Failed to parse sessionCostData from localStorage", e);
        }
      }
    };
    loadLastSession();
  }, []);

  useEffect(() => { localStorage.setItem("userPrompt", prompt); }, [prompt]);
  useEffect(() => { localStorage.setItem("userAudioSummaryPrompt", audioSummaryPrompt); }, [audioSummaryPrompt]);
  useEffect(() => { localStorage.setItem("selectedModel", selectedModel); }, [selectedModel]);
  useEffect(() => { localStorage.setItem("speakingRate", speakingRate.toString()); }, [speakingRate]);
  useEffect(() => { localStorage.setItem("wordsPerMinute", wordsPerMinute.toString()); }, [wordsPerMinute]);
  useEffect(() => { localStorage.setItem("maxSyncOffset", maxSyncOffset.toString()); }, [maxSyncOffset]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (youtubeUrl) {
        saveYoutubeUrl(youtubeUrl);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [youtubeUrl]);

  useEffect(() => {
    if (activeScene !== null && sceneRefs.current[activeScene] && analysisContainerRef.current) {
      const el = sceneRefs.current[activeScene];
      const container = analysisContainerRef.current;
      if (el) {
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();

        if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
          container.scrollBy({
            top: elRect.top - containerRect.top - 20,
            behavior: 'smooth'
          });
        }
      }
    }
  }, [activeScene]);



  /**
   * Handles the selection of a local video file.
   * @param event - The input change event containing the uploaded file.
   * @return Void
   */
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      saveVideo(selectedFile);
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
      setAnalysis(null);
      setSummaryAudioUrl(null);
      setSummaryAudioError(null);
      setActiveScene(null);
      clearAnalysis();
      clearAudio();
    }
  };

  /**
   * Clears the current session data, including video, analysis, and audio blobs.
   * @return A promise that resolves when clearing is complete.
   */
  const handleClear = async () => {
    await clearVideo();
    await clearAnalysis();
    await clearAudio();
    await clearYoutubeUrl();
    setFile(null);
    setYoutubeUrl("");
    setYoutubeInput("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setAnalysis(null);
    setSummaryAudioUrl(null);
    setSummaryAudioError(null);
    setActiveScene(null);
  };

  /**
   * Updates the active scene based on the current playback time of the video.
   * @param event - The generic synthetic React video event.
   * @return Void
   */
  const handleTimeUpdate = useCallback((event?: React.SyntheticEvent<HTMLVideoElement> | { playedSeconds: number }) => {
    if (isSeeking.current) return;
    if (analysis && analysis.scenes && analysis.scenes.length > 0) {
      let currentTime = -1;

      if (playerRef.current) {
        if (typeof playerRef.current.getCurrentTime === 'function') {
          const time = playerRef.current.getCurrentTime();
          if (typeof time === 'number') currentTime = time;
        } else if (typeof playerRef.current.currentTime === 'number') {
          currentTime = playerRef.current.currentTime;
        }
      }

      if (currentTime === -1 && event) {
        if ('playedSeconds' in event) {
          currentTime = event.playedSeconds;
        } else if ('currentTarget' in event) {
          const video = event.currentTarget as HTMLVideoElement;
          currentTime = video.currentTime;
        }
      }

      if (currentTime === -1) return;

      let currentSceneIndex = -1;

      for (let i = analysis.scenes.length - 1; i >= 0; i--) {
        const start = Number(analysis.scenes[i].start);
        const end = Number(analysis.scenes[i].end);
        if (currentTime >= start && currentTime < end) {
          currentSceneIndex = i;
          break;
        }
      }

      if (currentSceneIndex === -1) {
        let closestScene = -1;
        let minDistance = Infinity;
        for (let i = analysis.scenes.length - 1; i >= 0; i--) {
          const start = Number(analysis.scenes[i].start);
          const end = Number(analysis.scenes[i].end);
          let dist = Infinity;
          if (currentTime < start) dist = start - currentTime;
          else if (currentTime >= end) dist = currentTime - end;

          if (dist < minDistance && dist <= 2.0) {
            minDistance = dist;
            closestScene = i;
          }
        }
        currentSceneIndex = closestScene;
      }

      setActiveScene(prev => {
        const nextScene = currentSceneIndex !== -1 ? currentSceneIndex : null;
        return prev !== nextScene ? nextScene : prev;
      });
    }
  }, [analysis]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isSeeking.current && analysis && playerRef.current) {
        handleTimeUpdate();
      }
    }, 250);
    return () => clearInterval(interval);
  }, [handleTimeUpdate, analysis]);

  /**
   * Jumps the video player's current time to a specific scene's start time and highlights the scene.
   * @param sceneIndex - The index of the selected scene.
   * @return Void
   */
  const handleSceneClick = (sceneIndex: number) => {
    if (playerRef.current && analysis?.scenes[sceneIndex]) {
      const targetTime = Number(analysis.scenes[sceneIndex].start) + 0.05;

      isSeeking.current = true;
      if (seekTimeout.current) clearTimeout(seekTimeout.current);
      seekTimeout.current = setTimeout(() => {
        isSeeking.current = false;
      }, 500);

      if (typeof playerRef.current.seekTo === 'function') {
        playerRef.current.seekTo(targetTime, "seconds");
      } else if (typeof playerRef.current.currentTime !== 'undefined') {
        playerRef.current.currentTime = targetTime;
      }

      setActiveScene(sceneIndex);
    }
  };

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  /**
   * Handled when the video metadata loads to capture its duration.
   * @param event - The generic synthetic React video event.
   * @return Void
   */
  const handleLoadedMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    setVideoDurationSeconds(event.currentTarget.duration);
  };

  /**
   * Submits a fresh analysis operation to the Gemini backend, using either a local file or YouTube URL.
   * @param fileToAnalyze - The local video file (if available).
   * @param youtubeUrlToAnalyze - The YouTube URL (if available).
   * @return A promise that resolves when the analysis is successfully submitted and parsed.
   */
  const handleAnalyzeVideo = async (fileToAnalyze: File | null, youtubeUrlToAnalyze?: string) => {
    setIsLoading(true);
    setAnalysis(null);
    setSummaryAudioUrl(null);
    setSummaryAudioError(null);
    setActiveScene(null);
    setError(null);

    const resetSessionCost: SessionCostData = {
      ...INITIAL_SESSION_COSTData
    };
    setSessionCostData(resetSessionCost);
    localStorage.setItem("sessionCostData", JSON.stringify(resetSessionCost));

    const formData = new FormData();
    if (fileToAnalyze) formData.append("file", fileToAnalyze);
    if (youtubeUrlToAnalyze) formData.append("youtubeUrl", youtubeUrlToAnalyze);

    formData.append("model", selectedModel);

    abortControllerRef.current = new AbortController();

    try {
      const response = await analyzeVideoApi(file, youtubeUrl, prompt, selectedModel, abortControllerRef.current.signal) as { analysis: Analysis, usageMetadata: UsageMetadata, estimatedCost: number };
      const newAnalysis = response.analysis;
      if (response.usageMetadata) {
        setSessionCostData(prev => {
          const updated = {
            ...prev,
            totalPromptTokens: prev.totalPromptTokens + (response.usageMetadata.promptTokenCount || 0),
            totalCandidatesTokens: prev.totalCandidatesTokens + (response.usageMetadata.candidatesTokenCount || 0),
            totalCachedTokens: prev.totalCachedTokens + (response.usageMetadata.cachedContentTokenCount || 0),
            totalThoughtsTokens: prev.totalThoughtsTokens + (response.usageMetadata.thoughtsTokenCount || 0),
            totalEstimatedCost: prev.totalEstimatedCost + (response.estimatedCost || 0),
            geminiRuns: prev.geminiRuns + 1
          };
          localStorage.setItem("sessionCostData", JSON.stringify(updated));
          return updated;
        });
      }

      if (true) {
        setAnalysis(newAnalysis);
        saveAnalysis(newAnalysis);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;

      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      const details = (err as {details?: string})?.details || (err instanceof Error ? err.stack : String(err));

      setError({ message, details });
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  /**
   * Cancels the currently pending backend analysis HTTP request.
   * @return Void
   */
  const handleCancel = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
  };



  /**
   * Streams and plays an audio sequence for an individual scene using Google Cloud TTS.
   * @param sceneIndex - The index representing the scene to play audio for.
   * @param text - The specific text payload to convert to speech.
   * @return A promise that resolves when the audio fetch returns successfully.
   */
  const handlePlayAudio = async (sceneIndex: number, text: string) => {
    if (playingScene === sceneIndex) {
      audioRef.current?.pause();
      setPlayingScene(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    setIsAudioLoading(sceneIndex);
    setPlayingScene(null);
    try {
      const { blob, characters, estimatedCost } = await generateSpeechApi(text, selectedVoice, selectedLanguage, speakingRate);
      setSessionCostData(prev => {
        const updated = {
          ...prev,
          ttsCharacters: prev.ttsCharacters + characters,
          totalEstimatedCost: prev.totalEstimatedCost + estimatedCost,
          ttsRuns: prev.ttsRuns + 1
        };
        localStorage.setItem("sessionCostData", JSON.stringify(updated));
        return updated;
      });
      if (true) {
        const url = URL.createObjectURL(blob);
        audioRef.current = new Audio(url);
        audioRef.current.play();
        audioRef.current.onended = () => { setPlayingScene(null); };
        setPlayingScene(sceneIndex);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError({ message: err.message || 'An unexpected error occurred.', details: err.stack });
      } else {
        setError({ message: 'An unexpected error occurred.', details: String(err) });
      }
    } finally {
      setIsAudioLoading(null);
    }
  };


  /**
   * Replicates active developer error details into the system clipboard.
   * @return Void
   */
  const copyToClipboard = () => {
    if (error) {
      const errorDetails = `Error: ${error.message}\n\nDetails:\n${error.details}`;
      navigator.clipboard.writeText(errorDetails);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 md:p-8 font-sans">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-7xl mx-auto"
      >
        <header className="flex justify-between items-center mb-12">
          <div className="text-left flex items-center gap-3">
            <Activity className="text-[#2563eb]" size={40} />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-5xl font-semibold bg-clip-text text-transparent bg-gradient-to-br from-[#2563eb] to-[#3b82f6] font-outfit tracking-tight">
                  Audia
                </h1>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium tracking-wide text-[#2563eb] bg-[#2563eb]/10 border border-[#2563eb]/20">
                  v{APP_VERSION}
                </span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] font-medium">
                {APP_TAGLINE}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 p-3 rounded-xl text-[var(--text-secondary)] hover:bg-[var(--primary)] hover:text-white transition-all font-medium"
            title="Settings"
          >
            <span>Settings</span>
            <Settings size={24} />
          </button>
        </header>

        <AnimatePresence>
          {isFullscreenPlaying && summaryAudioUrl && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4"
            >
              <div className="absolute top-6 right-6">
                <button
                  onClick={() => setIsFullscreenPlaying(false)}
                  className="bg-white/10 hover:bg-white/20 text-white rounded-full p-3 transition-colors"
                >
                  <Trash2 size={24} className="hidden" />
                  <span className="font-bold text-lg leading-none block w-6 h-6 flex items-center justify-center">
                    ✕
                  </span>
                </button>
              </div>

              <div className="w-full max-w-6xl aspect-video bg-black relative rounded-xl overflow-hidden shadow-2xl">
                {previewUrl ? (
                  <video
                    ref={attachSyncVideo}
                    src={previewUrl}
                    className="w-full h-full object-contain"
                    controls={false}
                    autoPlay
                    onPlay={() => {
                      if (syncAudioRef.current && syncPlaying) {
                        syncAudioRef.current.play();
                      }
                    }}
                    onTimeUpdate={(
                      e: React.SyntheticEvent<HTMLVideoElement>
                    ) => {
                      const v = e.currentTarget;
                      if (v && v.duration - v.currentTime < 0.2) {
                        v.pause();
                        setSyncPlaying(false);
                      }
                    }}
                    onSeeking={() => {
                      if (syncAudioRef.current && syncVideoRef.current) {
                        syncAudioRef.current.currentTime =
                          syncVideoRef.current.currentTime;
                      }
                    }}
                  />
                ) : youtubeUrl ? (
                  <div className="w-full h-full pointer-events-none">
                    <TypedReactPlayer
                      ref={syncReactPlayerRef}
                      src={youtubeUrl}
                      playing={syncPlaying}
                      controls={false}
                      width="100%"
                      height="100%"
                      volume={SYNC_ORIGINAL_VIDEO_VOLUME}
                      config={{
                        youtube: {
                          playerVars: {
                            cc_load_policy: 0,
                            iv_load_policy: 3,
                          },
                        },
                      }}
                      onReady={() => {
                        const internal =
                          syncReactPlayerRef.current?.getInternalPlayer?.();
                        if (internal?.unloadModule) {
                          internal.unloadModule('captions');
                          internal.unloadModule('cc');
                        }
                      }}
                      onPlay={() => {
                        if (syncAudioRef.current && syncPlaying) {
                          syncAudioRef.current.play();
                        }
                      }}
                      onProgress={(
                        state:
                          | React.SyntheticEvent<HTMLVideoElement>
                          | { playedSeconds: number }
                      ) => {
                        const s = state as { playedSeconds: number };
                        const duration =
                          syncReactPlayerRef.current?.getDuration?.();
                        if (
                          duration &&
                          s.playedSeconds !== undefined &&
                          duration - s.playedSeconds < 0.3
                        ) {
                          setSyncPlaying(false);
                        }
                      }}
                    />
                  </div>
                ) : null}
              </div>

              <audio
                ref={syncAudioRef}
                src={summaryAudioUrl}
                className="hidden"
                controls
                autoPlay
              />

              <div className="mt-8 text-center max-w-2xl">
                <h3 className="text-xl font-bold text-white mb-2">
                  Synchronized Playback
                </h3>
                <p className="text-white/70">
                  Original video volume is lowered to{' '}
                  {Math.round(SYNC_ORIGINAL_VIDEO_VOLUME * 100)}%. Generated
                  audio is at 100%.
                </p>
                <div className="flex gap-4 justify-center mt-6">
                  <button
                    onClick={() => {
                      setSyncPlaying(true);
                      if (previewUrl && syncVideoRef.current) {
                        syncVideoRef.current.play();
                      }
                      if (syncAudioRef.current) syncAudioRef.current.play();
                    }}
                    className="bg-white/10 hover:bg-white/20 text-white rounded-full p-4 transition-colors"
                  >
                    <Play size={24} fill="currentColor" />
                  </button>
                  <button
                    onClick={() => {
                      setSyncPlaying(false);
                      if (previewUrl && syncVideoRef.current) {
                        syncVideoRef.current.pause();
                      }
                      if (syncAudioRef.current) syncAudioRef.current.pause();
                    }}
                    className="bg-white/10 hover:bg-white/20 text-white rounded-full p-4 transition-colors"
                  >
                    <Pause size={24} fill="currentColor" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-8 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-red-600 mb-1">
                    Error Occurred
                  </h3>
                  <p>{error.message}</p>
                </div>
                <button
                  onClick={() => setError(null)}
                  className="text-red-500 hover:text-red-700"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              {error.details && (
                <details className="mt-4 text-sm bg-[var(--bg-surface)] rounded-lg p-3">
                  <summary className="cursor-pointer text-red-500 flex items-center gap-2">
                    <span>Developer Details</span>
                    <button
                      onClick={e => {
                        e.preventDefault();
                        copyToClipboard();
                      }}
                      className="text-xs border border-red-200 px-2 py-1 rounded hover:bg-red-50"
                    >
                      Copy
                    </button>
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs opacity-80">
                    {error.details}
                  </pre>
                </details>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className={cn('flex flex-col gap-6', analysis && 'h-full')}>
            <section className="glass-panel p-6 flex flex-col flex-none">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Video className="text-[var(--primary)]" size={20} />
                Video Source
              </h2>

              {!(
                previewUrl ||
                (youtubeUrl && youtubeUrl.startsWith('http'))
              ) ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-2 flex-1">
                  <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-[var(--card-border)] rounded-2xl hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-all group cursor-pointer text-center h-full">
                    <div className="w-14 h-14 bg-[var(--primary)]/10 text-[var(--primary)] rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <Upload size={28} />
                    </div>
                    <span className="text-lg font-semibold text-[var(--foreground)] mb-1">
                      From Computer
                    </span>
                    <p className="text-sm text-[var(--text-secondary)]">
                      Drag & drop or browse files
                    </p>
                    <input
                      type="file"
                      className="hidden"
                      onChange={handleFileChange}
                      accept="video/*"
                    />
                  </label>

                  <div className="flex flex-col items-center justify-center p-8 border-2 border-[var(--card-border)] rounded-2xl bg-[var(--bg-surface)] text-center h-full group">
                    <div className="w-14 h-14 bg-red-50 text-red-600 rounded-full flex items-center justify-center mb-4 group-within:scale-110 transition-transform">
                      <Play size={28} fill="currentColor" />
                    </div>
                    <span className="text-lg font-semibold text-[var(--foreground)] mb-1">
                      YouTube Link
                    </span>
                    <p className="text-sm text-[var(--text-secondary)] mb-4 leading-tight">
                      The video must be either owned by your
                      <br />
                      Google Cloud account or be public.
                    </p>

                      <div className="w-full flex items-center gap-2 text-left">
                        <input
                          type="text"
                          placeholder="https://www.youtube.com/..."
                          className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded-lg p-3 text-sm focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none transition-all"
                          value={youtubeInput}
                          onChange={e => setYoutubeInput(e.target.value)}
                          onKeyDown={e => {
                            if (
                              e.key === 'Enter' &&
                              youtubeInput.startsWith('http')
                            ) {
                              setYoutubeUrl(youtubeInput);
                            }
                          }}
                        />
                        <button
                          onClick={() => {
                            if (youtubeInput.startsWith('http')) {
                              setYoutubeUrl(youtubeInput);
                            }
                          }}
                          disabled={!youtubeInput.startsWith('http')}
                          className="px-4 py-3 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shadow-lg shadow-[var(--primary)]/20"
                        >
                          Load
                        </button>
                      </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg overflow-hidden bg-[var(--bg-surface)] border border-[var(--card-border)] mb-4 shadow-2xl aspect-video">
                  {previewUrl ? (
                    <video
                      ref={playerRef}
                      src={previewUrl}
                      controls
                      className="w-full h-full object-contain"
                      onTimeUpdate={handleTimeUpdate}
                      onSeeked={e => {
                        isSeeking.current = false;
                        handleTimeUpdate(e);
                      }}
                      onLoadedMetadata={handleLoadedMetadata}
                      onError={e => {
                        const target = e.target as HTMLVideoElement;
                        console.error('Video Error:', target.error);
                        setError({
                          message: 'Failed to load video',
                          details:
                            'The video file might be corrupted or in an unsupported format.',
                        });
                      }}
                    />
                  ) : (
                    <TypedReactPlayer
                      ref={playerRef}
                      src={youtubeUrl}
                      controls
                      width="100%"
                      height="100%"
                      volume={playerVolume}
                      config={{
                        youtube: {
                          playerVars: {
                            cc_load_policy: 0,
                            iv_load_policy: 3,
                          },
                        },
                      }}
                      onReady={() => {
                        const internal =
                          playerRef.current?.getInternalPlayer?.();
                        if (internal?.unloadModule) {
                          internal.unloadModule('captions');
                          internal.unloadModule('cc');
                        }
                      }}
                      onVolumeChange={(e: unknown) => {
                        if (typeof e === 'number') setPlayerVolume(e);
                        else if (e && typeof e === 'object' && 'target' in e) {
                          const target = (e as Event)
                            .target as HTMLMediaElement;
                          if (target) setPlayerVolume(target.volume);
                        }
                      }}
                      onDuration={(duration: number) => {
                        if (duration > 0) {
                          setVideoDurationSeconds(duration);
                        }
                      }}
                      progressInterval={200}
                      onProgress={handleTimeUpdate}
                      onSeek={(seconds: number) => {
                        isSeeking.current = false;
                        handleTimeUpdate({ playedSeconds: seconds });
                      }}
                      onError={() => {
                        setError({
                          message: 'Failed to load YouTube video',
                          details: 'The URL might be invalid or unsupported.',
                        });
                      }}
                    />
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-3 items-center justify-between pt-6">
                <div className="flex gap-3 items-center">
                  {(file || youtubeUrl) && (
                    <button
                      onClick={handleClear}
                      className="glass-button px-3 py-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700"
                      title="Clear"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>

                {(file || youtubeUrl) && (
                  <button
                    onClick={() =>
                      isLoading
                        ? handleCancel()
                        : handleAnalyzeVideo(file, youtubeUrl)
                    }
                    className={cn(
                      'px-6 py-2 rounded-lg font-medium flex items-center gap-2 transition-all shadow-lg shadow-blue-500/20',
                      isLoading
                        ? 'bg-red-500 hover:bg-red-600 text-white'
                        : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white'
                    )}
                  >
                    {isLoading ? (
                      <>
                        <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                        Stop
                      </>
                    ) : (
                      <>
                        <Play size={16} fill="currentColor" />
                        Analyze
                      </>
                    )}
                  </button>
                )}
              </div>
            </section>

            {analysis && (
              <motion.section
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass-panel p-6 border-l-4 border-l-[var(--accent)] flex flex-col flex-1"
              >
                <div className="flex flex-col gap-4 mb-4 border-b border-[var(--card-border)] pb-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-bold text-[var(--foreground)] flex items-center gap-2">
                        <Volume2 className="text-[var(--primary)]" size={20} />
                        Audio Summary
                      </h3>
                      {summaryAudioDuration !== null && (
                        <span className="text-xs text-[var(--text-secondary)] ml-7">
                          Duration: {summaryAudioDuration.toFixed(1)}s
                        </span>
                      )}
                    </div>
                    {summaryAudioUrl && (
                      <a
                        href={summaryAudioUrl}
                        download="audio-summary.wav"
                        className="glass-button p-2 rounded-lg hover:bg-[var(--bg-surface-hover)] text-[var(--primary)] transition-colors"
                        title="Download Audio"
                      >
                        <Download size={18} />
                      </a>
                    )}
                  </div>

                  <div className="flex flex-col gap-3">
                    <input
                      type="text"
                      placeholder="Custom instructions for the summary (Optional)"
                      value={summaryInstructions}
                      onChange={e => setSummaryInstructions(e.target.value)}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--card-border)] rounded-lg p-2.5 text-sm outline-none focus:border-[var(--primary)] transition-colors"
                    />
                    <div className="flex flex-wrap gap-3 items-center">
                      <select
                        className="flex-1 min-w-[140px] bg-[var(--bg-surface)] border border-[var(--card-border)] rounded-lg p-2.5 text-sm outline-none focus:border-[var(--primary)]"
                        value={selectedLanguage}
                        onChange={e => setSelectedLanguage(e.target.value)}
                      >
                        {LANGUAGES.map(lang => (
                          <option key={lang.code} value={lang.code}>
                            {lang.name}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={handleRegenerateClick}
                        disabled={isSummaryTextLoading}
                        className={cn(
                          'px-4 py-2.5 rounded-lg font-medium flex items-center gap-2 transition-all shadow-lg shadow-blue-500/20 text-sm text-white',
                          isSummaryTextLoading
                            ? 'bg-gray-400 cursor-not-allowed opacity-80'
                            : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500'
                        )}
                      >
                        {isSummaryTextLoading ? (
                          <span className="animate-spin block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        ) : (
                          <FileText size={16} />
                        )}
                        <span>
                          {isSummaryTextLoading
                            ? `Generating summary in ${(LANGUAGES.find(l => l.code === selectedLanguage)?.name || selectedLanguage).split(' (')[0]}...`
                            : analysis?.audio_track?.description
                              ? 'Regenerate Summary'
                              : 'Generate Summary'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                <textarea
                  className={cn(
                    'w-full text-sm text-[var(--foreground)] placeholder:text-[var(--text-secondary)] leading-relaxed bg-[var(--bg-surface)] p-4 rounded-lg border resize-none flex-1 outline-none transition-all',
                    analysis?.audio_track?.language &&
                      analysis?.audio_track?.language !== selectedLanguage
                      ? 'border-amber-400 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 bg-amber-50/50'
                      : 'border-[var(--card-border)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]'
                  )}
                  value={analysis?.audio_track?.description || ''}
                  placeholder="The audio track description will appear here after generating."
                  onChange={e => {
                    const newDescription = e.target.value;
                    setAnalysis(prev => {
                      if (!prev) return null;
                      return {
                        ...prev,
                        audio_track: {
                          ...(prev.audio_track || {
                            voice: selectedVoice,
                            language: selectedLanguage,
                            speakingRate,
                          }),
                          description: newDescription,
                        },
                      };
                    });
                  }}
                  onBlur={() => {
                    if (analysis) saveAnalysis(analysis);
                  }}
                />

                {analysis?.audio_track?.language &&
                  analysis?.audio_track?.language !== selectedLanguage &&
                  analysis?.audio_track?.description && (
                    <p className="text-xs text-amber-600 mt-2">
                      Note: The generated text language (
                      {LANGUAGES.find(
                        l => l.code === analysis.audio_track!.language
                      )?.name || analysis.audio_track.language}
                      ) does not match your selected language (
                      {LANGUAGES.find(l => l.code === selectedLanguage)?.name ||
                        selectedLanguage}
                      ). Please regenerate the text summary or change the
                      language back.
                    </p>
                  )}

                <div className="flex flex-col gap-4 mt-6 pt-4 border-t border-[var(--card-border)]">
                  <div className="flex items-center justify-between">
                    <h4 className="text-md font-medium text-[var(--foreground)]">
                      Audio Generation
                    </h4>
                    <button
                      onClick={() => generateSummaryAudio()}
                      disabled={
                        !analysis ||
                        isSummaryAudioLoading ||
                        isSummaryTextLoading ||
                        !analysis?.audio_track?.description?.trim()
                      }
                      className={cn(
                        'px-4 py-2.5 rounded-lg font-medium flex items-center gap-2 transition-all shadow-lg shadow-blue-500/20 text-sm text-white',
                        !analysis ||
                          isSummaryAudioLoading ||
                          isSummaryTextLoading ||
                          !analysis?.audio_track?.description?.trim()
                          ? 'bg-gray-400 cursor-not-allowed opacity-80'
                          : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500'
                      )}
                    >
                      {isSummaryAudioLoading ? (
                        <span className="animate-spin block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      ) : summaryAudioUrl ? (
                        <RefreshCw size={16} />
                      ) : (
                        <Mic size={16} fill="currentColor" />
                      )}
                      <span>
                        {isSummaryAudioLoading
                          ? 'Generating audio...'
                          : summaryAudioUrl
                            ? 'Regenerate Audio'
                            : 'Generate Audio'}
                      </span>
                    </button>
                  </div>

                  {summaryAudioUrl && (
                    <div className="flex flex-col gap-3">
                      <audio
                        src={summaryAudioUrl}
                        controls
                        className="w-full h-8 opacity-80 hover:opacity-100 transition-opacity"
                      />

                      <button
                        onClick={() => setIsFullscreenPlaying(true)}
                        className="w-full px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all shadow-lg shadow-purple-500/20 text-sm text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500"
                      >
                        <Maximize size={16} />
                        Play Synchronized Fullscreen
                      </button>
                    </div>
                  )}

                  {summaryAudioError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                      {summaryAudioError}
                    </div>
                  )}
                </div>
              </motion.section>
            )}
          </div>

          <div className="space-y-6">
            <section className="glass-panel p-6 h-full flex flex-col">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Activity className="text-[var(--primary)]" size={20} />
                Analysis
              </h2>

              {isLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center min-h-[400px]">
                  <div className="relative w-24 h-24 mb-6">
                    <div className="absolute inset-0 border-4 border-[var(--card-border)] rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-[var(--primary)] rounded-full border-t-transparent animate-spin"></div>
                  </div>
                  <h3 className="text-xl font-semibold mb-2">
                    Analyzing Video...
                  </h3>
                  <p className="text-[var(--text-secondary)] max-w-xs mb-4">
                    This might take a minute depending on the video length.
                  </p>
                  <div className="text-sm text-[var(--text-secondary)] bg-[var(--bg-surface)] p-4 rounded-lg border border-[var(--card-border)] max-w-xs w-full">
                    <div className="flex justify-between mb-1">
                      <span>Model:</span>
                      <span className="font-medium text-[var(--foreground)]">
                        {{
                          'gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
                          'gemini-3.8-flash': 'Gemini 3.8 Flash',
                          'gemini-3.5-flash': 'Gemini 3.5 Flash',
                        }[selectedModel] || selectedModel}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span>Voice:</span>
                      <span className="font-medium text-[var(--foreground)]">
                        {selectedVoice}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mt-3">
                    You can change these in{' '}
                    <button
                      onClick={() => setIsSettingsOpen(true)}
                      className="text-[var(--primary)] hover:underline"
                    >
                      Settings
                    </button>
                  </p>
                </div>
              ) : !analysis ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center min-h-[400px] opacity-50">
                  <Video
                    size={64}
                    className="text-[var(--text-secondary)] mb-4"
                  />
                  <p className="text-lg text-[var(--text-secondary)]">
                    Upload a video to see the analysis here
                  </p>
                </div>
              ) : (
                <div
                  className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto pr-2 custom-scrollbar"
                  ref={analysisContainerRef}
                >
                  {analysis.scenes.map((scene, index) => (
                    <motion.div
                      key={index}
                      ref={el => {
                        sceneRefs.current[index] = el;
                      }}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      onClick={() => handleSceneClick(index)}
                      className={cn(
                        'glass-panel p-5 cursor-pointer transition-all border-l-4 group hover:bg-[var(--bg-surface-hover)]',
                        activeScene === index
                          ? 'border-l-[var(--primary)] bg-[var(--bg-surface)] shadow-lg shadow-blue-500/10'
                          : 'border-l-transparent hover:border-l-[var(--card-border)]'
                      )}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              'text-xs font-mono px-2 py-1 rounded bg-[var(--bg-surface)] text-[var(--text-secondary)]',
                              activeScene === index &&
                                'text-[var(--primary)] bg-[var(--primary)]/10'
                            )}
                          >
                            {scene.start.toFixed(1)}s - {scene.end.toFixed(1)}s
                          </span>
                          {activeScene === index && (
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                            </span>
                          )}
                        </div>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handlePlayAudio(index, scene.description);
                          }}
                          className={cn(
                            'p-2 rounded-full transition-colors',
                            playingScene === index
                              ? 'bg-[var(--primary)] text-white'
                              : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--primary)]'
                          )}
                        >
                          {isAudioLoading === index ? (
                            <span className="animate-spin block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                          ) : playingScene === index ? (
                            <Pause size={14} fill="currentColor" />
                          ) : (
                            <Play size={14} fill="currentColor" />
                          )}
                        </button>
                      </div>

                      <p className="text-sm leading-relaxed mb-3 text-[var(--foreground)]">
                        {scene.description}
                      </p>

                      {(scene.visibleText !== 'None' ||
                        scene.spokenText !== 'None') && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-3 border-t border-[var(--card-border)]">
                          {scene.visibleText !== 'None' && (
                            <div>
                              <span className="text-xs uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                                On-Screen Text
                              </span>
                              <p className="text-xs text-[var(--text-secondary)] italic">
                                {scene.visibleText}
                              </p>
                            </div>
                          )}
                          {scene.spokenText !== 'None' && (
                            <div>
                              <span className="text-xs uppercase tracking-wider text-[var(--text-secondary)] block mb-1">
                                Spoken
                              </span>
                              <p className="text-xs text-[var(--text-secondary)] italic">
                                {scene.spokenText}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        <footer className="mt-12 pt-6 border-t border-[var(--card-border)] text-xs text-[var(--text-secondary)] leading-relaxed">
          <p>
            <strong>Note:</strong> This solution uses AI to edit or generate assets for your ads. Whether your content requires labeling depends on the nature of your assets, where your ads serve, and specific legal obligations that apply to you. In some circumstances Google may automatically apply a label. Please consult with your legal team to determine if/when a label is required for your ads. You can add labels in Google&apos;s Ads products using the{' '}
            <a
              href="https://support.google.com/google-ads/answer/17140115"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--primary)] hover:underline"
            >
              AI label setting
            </a>
            .
          </p>
        </footer>
      </motion.div>
      <SettingsModal
        key={isSettingsOpen ? 'open' : 'closed'}
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false);
          setHighlightModelSettings(false);
        }}
        highlightModel={highlightModelSettings}
        onSave={newSettings => {
          setPrompt(newSettings.prompt);
          setAudioSummaryPrompt(newSettings.audioSummaryPrompt);
          setSelectedModel(newSettings.model);
          setSelectedVoice(newSettings.voice);
          setSpeakingRate(newSettings.speakingRate);
          setWordsPerMinute(newSettings.wordsPerMinute);
          setMaxSyncOffset(newSettings.maxSyncOffset);
          setIsSettingsOpen(false);
        }}
        initialSettings={{
          prompt,
          audioSummaryPrompt,
          model: selectedModel,
          voice: selectedVoice,
          language: selectedLanguage,
          speakingRate,
          wordsPerMinute,
          maxSyncOffset,
        }}
        sessionCostData={sessionCostData}
        voices={VOICES}
        defaultPrompt={DEFAULT_PROMPT}
        defaultAudioSummaryPrompt={DEFAULT_AUDIO_SUMMARY_PROMPT}
        defaultSpeakingRate={DEFAULT_SPEAKING_RATE}
        defaultWordsPerMinute={DEFAULT_WORDS_PER_MINUTE}
        defaultMaxSyncOffset={DEFAULT_MAX_SYNC_OFFSET}
      />
    </div>
  );
}
