// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors

export const decisionTypesafePackageName = "@ghosthand/decision-typesafe" as const;

export {
  CARRIER_PRESETS,
  type CarrierPreset,
  type CarrierProviderOptions,
  createCarrierDecisionProvider,
  createOpenRouterDecisionProvider,
  createVercelDecisionProvider,
  OPENROUTER_DECISION_PRESET,
  VERCEL_DECISION_PRESET,
} from "./carrier-presets.ts";
export { CostMeter, type CostMeterOptions, costUsd, DEFAULT_PRICE_INPUT_PER_M } from "./cost-meter.ts";
export { FAILOVER_KINDS, FallbackDecisionProvider, intersectCapabilities } from "./fallback-provider.ts";
export {
  countRefUses,
  estimateImageTokens,
  IMAGES_HEADER,
  readImageSize,
  sniffImageType,
  TYPESAFE_IMAGE_LIMITS,
} from "./images.ts";
export { type DecisionLogger, type LogFields, silentLogger } from "./logger.ts";
export { kindForStatus, mapSdkError } from "./map-sdk-error.ts";
export {
  CHARS_PER_TOKEN,
  estimateRequestTokens,
  estimateTokens,
  type PreflightCaps,
  preflight,
  type TokenEstimate,
} from "./preflight.ts";
export {
  createTypeSafeDecisionProvider,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_VISION_MODEL,
  type FetchLike,
  PROVIDER_NAME,
  TYPESAFE_DIRECT_CAPABILITIES,
  type TypeSafeDecisionProviderOptions,
} from "./typesafe-provider.ts";
export {
  abstainedNames,
  PROBABILITY_SUM_TOLERANCE,
  SCORE_MEAN_TOLERANCE,
  validateAnswers,
  validateBoxAnswer,
  validateChoiceAnswer,
  validateNoulAnswer,
  validateScoreAnswer,
} from "./validate-response.ts";
