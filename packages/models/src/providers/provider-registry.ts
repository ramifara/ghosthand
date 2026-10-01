// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Providers turn a model id into an AI SDK language model. Phase 1 ships OpenAI only; the other
// kinds are declared so config, the catalog and `models list` can name them before Phase 6
// adds their factories (and their `@ai-sdk/*` dependencies).
import type { JSONValue, LanguageModel } from "ai";

/** A concrete AI SDK model object (never a gateway id string). */
export type SdkLanguageModel = Exclude<LanguageModel, string>;

/** Provider options keyed by provider name, as the AI SDK takes them. */
export type ProviderCallOptions = Record<string, Record<string, JSONValue>>;

export type ProviderKind =
  | "openai"
  /** Phase 2: Sign in with ChatGPT tokens against the public Responses API. */
  | "openai-chatgpt"
  /** Phase 6. */
  | "anthropic"
  | "google"
  | "openrouter"
  | "openai-compatible";

/** Provider kinds with a working factory in this build. */
export const IMPLEMENTED_PROVIDER_KINDS: ReadonlySet<ProviderKind> = new Set<ProviderKind>(["openai"]);

export interface ModelProvider {
  /** Catalog provider id, the part before the slash in `provider/model`. */
  readonly id: string;
  readonly kind: ProviderKind;
  /** False when the provider has no credentials; calls then fail with `not_configured`. */
  readonly configured: boolean;
  languageModel(modelId: string): SdkLanguageModel;
  /** Provider options for every call (e.g. `{ openai: { store: false } }`). */
  readonly callOptions?: ProviderCallOptions;
}

export interface ProviderRegistry {
  get(id: string): ModelProvider | undefined;
  list(): readonly ModelProvider[];
  isConfigured(id: string): boolean;
}

export function createProviderRegistry(providers: readonly ModelProvider[]): ProviderRegistry {
  const byId = new Map<string, ModelProvider>();
  for (const p of providers) {
    if (byId.has(p.id)) throw new Error(`duplicate provider id "${p.id}"`);
    byId.set(p.id, p);
  }
  return {
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
    isConfigured: (id) => byId.get(id)?.configured === true,
  };
}
