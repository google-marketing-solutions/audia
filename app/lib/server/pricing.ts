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
 * Backend utility for calculating Gemini and Text-to-Speech costs.
 * Centralizes pricing logic as per code style guidelines (functional, no magic numbers).
 */

import {GenerateContentResponse} from '@google/genai';

/** Pricing configuration for Vertex AI Gemini and Cloud Text-to-Speech. */
export const PRICING_CONFIG = {
  gemini: {
    pro: {
      inputPer1M: 1.25,
      outputPer1M: 3.75,
    },
    flash: {
      inputPer1M: 0.075,
      outputPer1M: 0.30,
    },
    discounts: {
      cachedMultiplier: 0.25,
    },
    groundingPerRequest: 0.035,
  },
  tts: {
    chirp3HdPer1MChars: 30.00,
  }
};

/** Type representing the pricing configuration structure. */
export type PricingConfig = typeof PRICING_CONFIG;

/**
 * Calculates the estimated cost for a Gemini API request based on usage metadata and model.
 *
 * @param response - The GenerateContentResponse object returned from the GenAI SDK.
 * @return The estimated cost in USD.
 */
export function calculateGeminiCost(response: GenerateContentResponse): number {
  if (!response || !response.usageMetadata) return 0;

  const usage = response.usageMetadata;
  const model = response.modelVersion || '';

  const isFlash = model.includes('flash');

  const inputRate = isFlash ? PRICING_CONFIG.gemini.flash.inputPer1M / 1000000 : PRICING_CONFIG.gemini.pro.inputPer1M / 1000000;
  const cachedInputRate = inputRate * PRICING_CONFIG.gemini.discounts.cachedMultiplier;
  const outputRate = isFlash ? PRICING_CONFIG.gemini.flash.outputPer1M / 1000000 : PRICING_CONFIG.gemini.pro.outputPer1M / 1000000;

  const totalInputTokens = usage.promptTokenCount || 0;
  const cachedTokens = usage.cachedContentTokenCount || 0;
  const outputTokens = (usage as { candidatesTokenCount?: number }).candidatesTokenCount || 0;

  const standardInputTokens = Math.max(0, totalInputTokens - cachedTokens);

  const inputCost = (standardInputTokens * inputRate) + (cachedTokens * cachedInputRate);
  const outputCost = outputTokens * outputRate;

  let groundingCost = 0;
  // Check if grounding was utilized in any of the candidates
  if (response.candidates && response.candidates.some(c => c.groundingMetadata)) {
    groundingCost = PRICING_CONFIG.gemini.groundingPerRequest;
  }

  return inputCost + outputCost + groundingCost;
}

/**
 * Calculates the estimated cost for a Text-to-Speech generation request.
 *
 * @param text - The text string that was synthesized.
 * @return The estimated cost in USD based on Chirp 3 HD pricing.
 */
export function calculateTTSCost(text: string): number {
  if (!text) return 0;

  const charCount = text.length;
  const ratePerChar = PRICING_CONFIG.tts.chirp3HdPer1MChars / 1000000;

  return charCount * ratePerChar;
}
