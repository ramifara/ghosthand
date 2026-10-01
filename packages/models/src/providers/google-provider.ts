// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Google Gemini (Generative Language API) with an API key (`GOOGLE_GENERATIVE_AI_API_KEY`).
// Gemini's computer-use tool only exists on the stateful Interactions API, which `@ai-sdk/google`
// 4.0.87 exposes without a tool factory; grounding uses the JSON path on Gemini's 0-999 grid.
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ModelProvider, SdkLanguageModel } from "./provider-registry.ts";

export interface GoogleProviderOptions {
  readonly apiKey?: string | undefined;
  /** Defaults to `https://generativelanguage.googleapis.com/v1beta`. */
  readonly baseURL?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Catalog provider id; defaults to `google`. */
  readonly id?: string;
}

export function createGoogleProvider(options: GoogleProviderOptions = {}): ModelProvider {
  const apiKey = options.apiKey?.trim() ?? "";
  const configured = apiKey.length > 0;
  const sdk = createGoogleGenerativeAI({
    apiKey: configured ? apiKey : "not-configured",
    ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });
  return {
    id: options.id ?? "google",
    kind: "google",
    configured,
    languageModel: (modelId: string): SdkLanguageModel => sdk.languageModel(modelId),
  };
}
