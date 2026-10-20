// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Jev through other carriers that speak TypeSafe's System One API, using the same SDK with a
// different base URL (docs/research/notes/openrouter-jev.md):
// - OpenRouter: `POST https://openrouter.ai/api/v1/systemone`, model `typesafe/jev-1.13`, 32k context
//   (state plus questions), `usage.cost` in each response.
// - Vercel AI Gateway: `POST https://ai-gateway.vercel.sh/typesafe/v1/systemone`, model
//   `typesafe-ai/jev`, cost in `provider_metadata.gateway.cost`.
import type { DecisionCapabilities, DecisionCarrier, DecisionProvider } from "@ghosthand/protocol";
import { MAX_CHOICE_OPTIONS, MAX_SCORE_LEVELS } from "@ghosthand/protocol";
import type { TypeSafeDecisionProviderOptions } from "./typesafe-provider.ts";
import { createTypeSafeDecisionProvider } from "./typesafe-provider.ts";

export interface CarrierPreset {
  readonly carrier: DecisionCarrier;
  readonly baseUrl: string;
  readonly model: string;
  /** Env-file variable that holds the key. */
  readonly keyEnv: string;
  readonly capabilities: DecisionCapabilities;
}

export const OPENROUTER_DECISION_PRESET: CarrierPreset = {
  carrier: "openrouter",
  baseUrl: "https://openrouter.ai/api",
  model: "typesafe/jev-1.13",
  keyEnv: "OPENROUTER_API_KEY",
  // OpenRouter lists 32,000 tokens for state plus questions; budget that for the whole request.
  capabilities: {
    maxOptions: MAX_CHOICE_OPTIONS,
    maxLevels: MAX_SCORE_LEVELS,
    contextTokens: 32_000,
    perQuestionContextTokens: 32_000,
    zdr: false,
  },
};

export const VERCEL_DECISION_PRESET: CarrierPreset = {
  carrier: "vercel",
  baseUrl: "https://ai-gateway.vercel.sh/typesafe",
  model: "typesafe-ai/jev",
  keyEnv: "AI_GATEWAY_API_KEY",
  // The gateway's context limit is not documented; assume OpenRouter's 32k until measured.
  capabilities: {
    maxOptions: MAX_CHOICE_OPTIONS,
    maxLevels: MAX_SCORE_LEVELS,
    contextTokens: 32_000,
    perQuestionContextTokens: 32_000,
    zdr: false,
  },
};

export type CarrierProviderOptions = Omit<TypeSafeDecisionProviderOptions, "providerName">;

function fromPreset(preset: CarrierPreset, opts: CarrierProviderOptions): DecisionProvider {
  return createTypeSafeDecisionProvider({
    // Gateways are not known to accept zstd request bodies; send plain JSON.
    compression: false,
    ...opts,
    providerName: preset.carrier,
    model: opts.model ?? preset.model,
    baseUrl: opts.baseUrl ?? preset.baseUrl,
    capabilities: { ...preset.capabilities, ...opts.capabilities },
  });
}

/** Jev on OpenRouter with an `OPENROUTER_API_KEY`. */
export function createOpenRouterDecisionProvider(opts: CarrierProviderOptions): DecisionProvider {
  return fromPreset(OPENROUTER_DECISION_PRESET, opts);
}

/** Jev on the Vercel AI Gateway with an `AI_GATEWAY_API_KEY`. */
export function createVercelDecisionProvider(opts: CarrierProviderOptions): DecisionProvider {
  return fromPreset(VERCEL_DECISION_PRESET, opts);
}

export const CARRIER_PRESETS: Readonly<Record<Exclude<DecisionCarrier, "typesafe">, CarrierPreset>> = {
  openrouter: OPENROUTER_DECISION_PRESET,
  vercel: VERCEL_DECISION_PRESET,
};

/** One factory for every carrier, for config-driven wiring. */
export function createCarrierDecisionProvider(
  carrier: DecisionCarrier,
  opts: CarrierProviderOptions,
): DecisionProvider {
  if (carrier === "typesafe") return createTypeSafeDecisionProvider(opts);
  return fromPreset(CARRIER_PRESETS[carrier], opts);
}
