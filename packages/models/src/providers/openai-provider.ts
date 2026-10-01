// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// OpenAI over the Responses API with an API key. The key is passed in by the engine (env file or
// safeStorage); this package never reads files or `process.env`.
import { createOpenAI } from "@ai-sdk/openai";
import type { ModelProvider, SdkLanguageModel } from "./provider-registry.ts";

export interface OpenAIProviderOptions {
  readonly apiKey?: string | undefined;
  /** Defaults to `https://api.openai.com/v1`. */
  readonly baseURL?: string;
  readonly organization?: string;
  readonly project?: string;
  /** Injected in tests and for SIWC token refresh later. */
  readonly fetch?: typeof globalThis.fetch;
  /** Catalog provider id; defaults to `openai`. */
  readonly id?: string;
}

export function createOpenAIProvider(options: OpenAIProviderOptions = {}): ModelProvider {
  const apiKey = options.apiKey?.trim() ?? "";
  const configured = apiKey.length > 0;
  const sdk = createOpenAI({
    // The SDK reads OPENAI_API_KEY from the environment when no key is given. Pass a placeholder
    // instead so an unconfigured provider never picks up ambient credentials; it is not called.
    apiKey: configured ? apiKey : "not-configured",
    ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
    ...(options.organization !== undefined ? { organization: options.organization } : {}),
    ...(options.project !== undefined ? { project: options.project } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });
  return {
    id: options.id ?? "openai",
    kind: "openai",
    configured,
    languageModel: (modelId: string): SdkLanguageModel => sdk.responses(modelId),
    // Do not keep screenshots and prompts on OpenAI's side.
    callOptions: { openai: { store: false } },
  };
}
