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

import {AnimatePresence, motion} from 'framer-motion';
import {useEffect, useRef, useState} from 'react';
import {Play, RotateCcw, Settings, Info} from 'react-feather';
import {getPricingApi} from '../lib/api';
import type {PricingConfig} from '../lib/server/pricing';
import {
  APP_VERSION,
  DEFAULT_SPEAKING_RATE,
  DEFAULT_WORDS_PER_MINUTE,
  DEFAULT_MAX_SYNC_OFFSET,
  ModelType,
} from '../lib/constants';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: {
    prompt: string;
    audioSummaryPrompt: string;
    model: ModelType;
    voice: string;
    speakingRate: number;
    wordsPerMinute: number;
    maxSyncOffset: number;
  }) => void;
  initialSettings: {
    prompt: string;
    audioSummaryPrompt: string;
    model: ModelType;
    voice: string;
    language: string;
    speakingRate: number;
    wordsPerMinute: number;
    maxSyncOffset: number;
  };
  sessionCostData?: {
    totalPromptTokens: number;
    totalCandidatesTokens: number;
    totalCachedTokens: number;
    totalThoughtsTokens: number;
    ttsCharacters: number;
    geminiRuns: number;
    ttsRuns: number;
    totalEstimatedCost: number;
  };
  voices: Array<{ name: string; gender: string; url: string }>;
  defaultPrompt: string;
  defaultAudioSummaryPrompt: string;
  defaultModel?: ModelType;
  defaultVoice?: string;
  defaultSpeakingRate?: number;
  defaultWordsPerMinute?: number;
  defaultMaxSyncOffset?: number;
  highlightModel?: boolean;
}

/**
 * SettingsModal provides a dialog where users can configure the AI models, prompts,
 * and voice settings used in the application.
 *
 * @return A React functional component rendering the settings modal dialog.
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialSettings,
  sessionCostData,
  voices,
  defaultPrompt,
  defaultAudioSummaryPrompt,
  defaultModel = 'gemini-3.1-pro-preview',
  defaultVoice = 'Algenib',
  defaultSpeakingRate = DEFAULT_SPEAKING_RATE,
  defaultWordsPerMinute = DEFAULT_WORDS_PER_MINUTE,
  defaultMaxSyncOffset = DEFAULT_MAX_SYNC_OFFSET,
  highlightModel = false,
}) => {
  const [prompt, setPrompt] = useState(initialSettings.prompt);
  const [audioSummaryPrompt, setAudioSummaryPrompt] = useState(
    initialSettings.audioSummaryPrompt
  );
  const [model, setModel] = useState<ModelType>(initialSettings.model);
  const [voice, setVoice] = useState(initialSettings.voice);
  const [speakingRate, setSpeakingRate] = useState(
    initialSettings.speakingRate
  );
  const [wordsPerMinute, setWordsPerMinute] = useState(
    initialSettings.wordsPerMinute
  );
  const [maxSyncOffset, setMaxSyncOffset] = useState(
    initialSettings.maxSyncOffset
  );
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [pricingConfig, setPricingConfig] = useState<PricingConfig | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    getPricingApi()
      .then(cfg => setPricingConfig(cfg))
      .catch(console.error);
  }, []);

  const getEstimatedCost = () => {
    if (!sessionCostData) return '0.0000';
    return sessionCostData.totalEstimatedCost.toFixed(4);
  };

  const isFlash = model.includes('flash');
  const inputPrice = pricingConfig
    ? isFlash
      ? pricingConfig.gemini.flash.inputPer1M
      : pricingConfig.gemini.pro.inputPer1M
    : '...';
  const outputPrice = pricingConfig
    ? isFlash
      ? pricingConfig.gemini.flash.outputPer1M
      : pricingConfig.gemini.pro.outputPer1M
    : '...';
  const ttsPrice = pricingConfig ? pricingConfig.tts.chirp3HdPer1MChars : '...';

  // Cleanup preview audio on unmount
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    };
  }, []);

  // Handle ESC key to close and Enter to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        // Do not save if the user is typing inside a textarea (they probably want a new line)
        if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') {
          return;
        }

        e.preventDefault(); // Prevent accidental form submissions if any
        onSave({
          prompt,
          audioSummaryPrompt,
          model,
          voice,
          speakingRate,
          wordsPerMinute,
          maxSyncOffset,
        });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, onSave, prompt, audioSummaryPrompt, model, voice, speakingRate, wordsPerMinute, maxSyncOffset]);

  const handlePreviewVoice = async () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setIsPreviewLoading(true);
    try {
      const response = await fetch('/api/text-to-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Hello, this is a preview of the ${voice} voice.`,
          voice,
          language: initialSettings.language,
          speakingRate,
        }),
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        previewAudioRef.current = audio;
        audio.play().catch(err => {
          if (err.name !== 'AbortError') {
            console.error('Error playing preview:', err);
          }
        });
        audio.onended = () => {
          previewAudioRef.current = null;
          setIsPreviewLoading(false);
        };
      } else {
        console.error('Failed to generate preview audio');
        setIsPreviewLoading(false);
      }
    } catch (err) {
      console.error('Error generating preview audio', err);
      setIsPreviewLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-auto-hide p-6 shadow-2xl bg-[var(--background)] border border-[var(--card-border)] rounded-2xl flex flex-col"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <Settings className="text-[var(--primary)]" size={24} />
                Configuration{' '}
                <span className="text-xs bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] px-2 py-1 rounded-md ml-2 font-normal">
                  v{APP_VERSION}
                </span>
              </h2>
            </div>

            <div className="space-y-6 flex-1 overflow-y-auto scrollbar-auto-hide pr-2 -mr-2">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Video Analysis Instruction
                </label>
                <textarea
                  className="w-full bg-[var(--bg-surface)] border border-[var(--card-border)] rounded-lg p-3 text-sm focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none transition-all"
                  rows={6}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Audio Summary Payload Instruction
                </label>
                <textarea
                  className="w-full bg-[var(--bg-surface)] border border-[var(--card-border)] rounded-lg p-3 text-sm focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none transition-all"
                  rows={3}
                  value={audioSummaryPrompt}
                  onChange={e => setAudioSummaryPrompt(e.target.value)}
                  placeholder="Instructions sent back to Gemini in the schema block for defining the audio_track summary constraint."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2 flex items-center gap-2">
                    Model
                    {highlightModel && (
                      <div className="text-red-500 flex items-center gap-1 ml-2">
                        <span className="text-xs font-bold animate-pulse">Required</span>
                        <div className="animate-bounce" style={{ animationDirection: 'alternate-reverse' }}>
                          <svg className="w-5 h-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                        </div>
                      </div>
                    )}
                  </label>
                  <div className="relative">
                    <select
                      className={`w-full bg-[var(--bg-surface)] border rounded-lg p-3 text-sm outline-none transition-all ${
                        highlightModel
                          ? 'border-red-500 ring-2 ring-inset ring-red-500/50 bg-red-50/50'
                          : 'border-[var(--card-border)] focus:border-[var(--primary)]'
                      }`}
                      value={model}
                      onChange={e => setModel(e.target.value as ModelType)}
                    >
                      <option value="gemini-3.1-pro-preview">
                        Gemini 3.1 Pro Preview
                      </option>
                      <option value="gemini-3.8-flash">
                        Gemini 3.8 Flash
                      </option>
                      <option value="gemini-3.5-flash">
                        Gemini 3.5 Flash
                      </option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                    Voice
                  </label>
                  <div className="flex gap-2">
                    <select
                      className="w-full bg-[var(--bg-surface)] border border-[var(--card-border)] rounded-lg p-3 text-sm outline-none focus:border-[var(--primary)]"
                      value={voice}
                      onChange={e => setVoice(e.target.value)}
                    >
                      {voices.map(v => (
                        <option key={v.name} value={v.name}>
                          {v.name} ({v.gender})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handlePreviewVoice}
                      disabled={isPreviewLoading}
                      className="glass-button p-3 rounded-lg text-[var(--primary)] hover:bg-[var(--primary)]/10"
                    >
                      {isPreviewLoading ? (
                        <span className="animate-spin block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                      ) : (
                        <Play size={16} />
                      )}
                    </button>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                    Target Words per Minute: {wordsPerMinute} wpm
                  </label>
                  <input
                    type="range"
                    min="50"
                    max="300"
                    step="5"
                    value={wordsPerMinute}
                    onChange={e =>
                      setWordsPerMinute(Number(e.target.value))
                    }
                    className="w-full h-2 bg-[var(--card-border)] rounded-lg appearance-none cursor-pointer accent-[var(--primary)]"
                  />
                  <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
                    <span>50 wpm</span>
                    <span>150 wpm</span>
                    <span>300 wpm</span>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                    Speaking Rate: {speakingRate.toFixed(2)}x
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round(50 * Math.log2(speakingRate / 0.5))}
                    onChange={e => {
                      const val = Number(e.target.value);
                      const rate = 0.5 * Math.pow(2, val / 50);
                      setSpeakingRate(rate);
                    }}
                    className="w-full h-2 bg-[var(--card-border)] rounded-lg appearance-none cursor-pointer accent-[var(--primary)]"
                  />
                  <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
                    <span>0.5x</span>
                    <span>1.0x</span>
                    <span>2.0x</span>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2 flex items-center gap-2">
                    Max Sync Offset: {maxSyncOffset.toFixed(1)}s
                    <div className="relative group cursor-help">
                      <Info size={14} className="text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors" />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 bg-[var(--background)] border border-[var(--card-border)] rounded-lg shadow-lg text-xs text-[var(--foreground)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        Controls how closely the generated audio summary must align with the original video&apos;s timeline events. A smaller offset enforces strict synchronization but might restrict the model&apos;s natural phrasing, while a larger offset provides more flexibility for natural pacing.
                      </div>
                    </div>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.5"
                    value={maxSyncOffset}
                    onChange={e =>
                      setMaxSyncOffset(Number(e.target.value))
                    }
                    className="w-full h-2 bg-[var(--card-border)] rounded-lg appearance-none cursor-pointer accent-[var(--primary)]"
                  />
                  <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
                    <span>0s</span>
                    <span>5s</span>
                    <span>10s</span>
                  </div>
                </div>
              </div>

              {sessionCostData &&
                (sessionCostData.geminiRuns > 0 ||
                  sessionCostData.ttsRuns > 0) && (
                  <div className="hidden mt-6 p-4 bg-[var(--primary)]/5 border border-[var(--primary)]/20 rounded-xl">
                    <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4 flex items-center justify-between">
                      <div>
                        Total Session Cost
                        <span className="block text-[10px] font-normal text-[var(--text-secondary)]">
                          Since last video load
                        </span>
                      </div>
                      <span className="font-bold text-[var(--primary)] text-right">
                        ${getEstimatedCost()}
                      </span>
                    </h3>

                    {sessionCostData.geminiRuns > 0 && (
                      <div className="mb-4">
                        <h4 className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-secondary)] mb-2 flex justify-between">
                          <span>
                            Gemini API ({sessionCostData.geminiRuns} generation
                            {sessionCostData.geminiRuns > 1 ? 's' : ''})
                          </span>
                          <span className="opacity-70 normal-case">
                            ${inputPrice}/1M In, ${outputPrice}/1M Out
                          </span>
                        </h4>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className="block text-[var(--text-secondary)] opacity-80">
                              Total Input
                            </span>
                            <span className="font-medium">
                              {sessionCostData.totalPromptTokens.toLocaleString()}
                            </span>
                          </div>
                          {sessionCostData.totalCachedTokens > 0 && (
                            <div>
                              <span className="block text-[var(--text-secondary)] opacity-80">
                                Cached Input
                              </span>
                              <span className="font-medium text-green-600 dark:text-green-400">
                                {sessionCostData.totalCachedTokens.toLocaleString()}
                              </span>
                            </div>
                          )}
                          <div>
                            <span className="block text-[var(--text-secondary)] opacity-80">
                              Total Output
                            </span>
                            <span className="font-medium">
                              {sessionCostData.totalCandidatesTokens.toLocaleString()}
                            </span>
                          </div>
                          {sessionCostData.totalThoughtsTokens > 0 && (
                            <div>
                              <span className="block text-[var(--text-secondary)] opacity-80">
                                Thinking Tokens*
                              </span>
                              <span className="font-medium text-amber-600 dark:text-amber-400">
                                {sessionCostData.totalThoughtsTokens.toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {sessionCostData.ttsRuns > 0 && (
                      <div className="mb-2 pt-3 border-t border-[var(--primary)]/10">
                        <h4 className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-secondary)] mb-2 flex justify-between">
                          <span>
                            Cloud TTS ({sessionCostData.ttsRuns} generation
                            {sessionCostData.ttsRuns > 1 ? 's' : ''})
                          </span>
                          <span className="opacity-70 normal-case">
                            Chirp3 HD (${ttsPrice}/1M)
                          </span>
                        </h4>
                        <div className="text-xs">
                          <span className="block text-[var(--text-secondary)] opacity-80">
                            Synthesized Characters
                          </span>
                          <span className="font-medium">
                            {sessionCostData.ttsCharacters.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    )}

                    <p className="text-[10px] text-[var(--text-secondary)] italic mt-4 pt-3 border-t border-[var(--primary)]/10">
                      * Estimated total costs for the current session. Gemini
                      output limits include &quot;thinking&quot; tokens. Actual
                      costs depend on cloud billing tier. See{' '}
                      <a
                        href="https://cloud.google.com/vertex-ai/generative-ai/pricing"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--primary)] hover:underline"
                      >
                        Pricing Docs
                      </a>
                      .
                    </p>
                  </div>
                )}
            </div>

            <div className="flex justify-between items-center mt-8 pt-4 border-t border-[var(--card-border)]">
              <button
                onClick={() => {
                  setPrompt(defaultPrompt);
                  setAudioSummaryPrompt(defaultAudioSummaryPrompt);
                  setModel(defaultModel);
                  setVoice(defaultVoice);
                  setSpeakingRate(defaultSpeakingRate);
                  setWordsPerMinute(defaultWordsPerMinute);
                  setMaxSyncOffset(defaultMaxSyncOffset);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--primary)] transition-colors"
              >
                <RotateCcw size={16} />
                Reset to Default
              </button>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    onSave({
                      prompt,
                      audioSummaryPrompt,
                      model,
                      voice,
                      speakingRate,
                      wordsPerMinute,
                      maxSyncOffset,
                    })
                  }
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition-colors shadow-lg shadow-[var(--primary)]/20"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
