// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Providers turn a model id into an AI SDK language model. Phase 6 adds Anthropic, Google,
// OpenRouter and local OpenAI-compatible servers next to OpenAI; `openai-chatgpt` (Sign in with
// ChatGPT) arrives with the desktop app.
import type { JSONValue, LanguageModel, ProviderMetadata, ToolSet } from "ai";
import type { NativeComputerTool } from "../catalog/ghosthand-fields.ts";

/** A concrete AI SDK model object (never a gateway id string). */
export type SdkLanguageModel = Exclude<LanguageModel, string>;

/** Provider options keyed by provider name, as the AI SDK takes them. */
export type ProviderCallOptions = Record<string, Record<string, JSONValue>>;

export type ProviderKind =
  | "openai"
  /** Phase 2: Sign in with ChatGPT tokens against the public Responses API. */
  | "openai-chatgpt"
  | "anthropic"
  | "google"
  | "openrouter"
  /** Ollama, LM Studio, vLLM, llama.cpp server or any other `/v1/chat/completions` server. */
  | "openai-compatible";

/** Provider kinds with a working factory in this build. */
export const IMPLEMENTED_PROVIDER_KINDS: ReadonlySet<ProviderKind> = new Set<ProviderKind>([
  "openai",
  "openai-chatgpt",
  "anthropic",
  "google",
  "openrouter",
  "openai-compatible",
]);

/** Screenshot size the native tool should assume, in image pixels. */
export interface ComputerDisplay {
  readonly width: number;
  readonly height: number;
}

/** A vendor computer-use tool ready to pass to `generateText`, under the name the vendor expects. */
export interface NativeComputerToolSet {
  readonly tool: NativeComputerTool;
  readonly tools: ToolSet;
  readonly toolName: string;
}

export interface ModelProvider {
  /** Catalog provider id, the part before the slash in `provider/model`. */
  readonly id: string;
  readonly kind: ProviderKind;
  /** False when the provider has no credentials; calls then fail with `not_configured`. */
  readonly configured: boolean;
  languageModel(modelId: string): SdkLanguageModel;
  /** Provider options for every call (e.g. `{ openai: { store: false } }`). */
  readonly callOptions?: ProviderCallOptions;
  /** The vendor computer-use tool for `tool`, when this provider can send it. */
  nativeComputerTool?(tool: NativeComputerTool, display: ComputerDisplay): NativeComputerToolSet | undefined;
  /** Cost in USD reported by the provider for one call (OpenRouter `usage.cost`), when present. */
  reportedCostUsd?(metadata: ProviderMetadata | undefined): number | undefined;
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
