// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Chat Completions servers: local OpenAI-compatible servers (Ollama, LM Studio, vLLM, llama.cpp
// server) and OpenRouter. Both go through `@ai-sdk/openai-compatible` with a metadata extractor
// that keeps two fields the SDK drops: `usage.cost` (OpenRouter) and token logprobs (the logprob
// decision emulation).
import type { MetadataExtractor } from "@ai-sdk/openai-compatible";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { JSONValue, ProviderMetadata } from "ai";
import { z } from "zod";
import type { ModelProvider, ProviderCallOptions, SdkLanguageModel } from "./provider-registry.ts";

/** Provider-metadata key our extractor writes under. */
export const GHOSTHAND_METADATA_KEY = "ghosthand";

const TopLogprob = z.object({ token: z.string(), logprob: z.number() });
const TokenLogprob = z.object({
  token: z.string(),
  logprob: z.number(),
  top_logprobs: z.array(TopLogprob).nullish(),
});
const ChatBody = z.object({
  choices: z
    .array(z.object({ logprobs: z.object({ content: z.array(TokenLogprob).nullish() }).nullish() }))
    .nullish(),
  usage: z.object({ cost: z.number().nonnegative().nullish() }).nullish(),
});

export interface TokenLogprobs {
  readonly token: string;
  readonly logprob: number;
  readonly top: readonly { readonly token: string; readonly logprob: number }[];
}

/** Pulls `usage.cost` and first-choice logprobs out of a raw Chat Completions body. */
export function extractChatMetadata(body: unknown): Record<string, JSONValue> | undefined {
  const parsed = ChatBody.safeParse(body);
  if (!parsed.success) return undefined;
  const out: Record<string, JSONValue> = {};
  const cost = parsed.data.usage?.cost;
  if (cost !== undefined && cost !== null) out.costUsd = cost;
  const content = parsed.data.choices?.[0]?.logprobs?.content;
  if (content !== undefined && content !== null) {
    out.logprobs = content.map((t) => ({
      token: t.token,
      logprob: t.logprob,
      top: (t.top_logprobs ?? []).map((x) => ({ token: x.token, logprob: x.logprob })),
    }));
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

const metadataExtractor: MetadataExtractor = {
  extractMetadata: async ({ parsedBody }) => {
    const data = extractChatMetadata(parsedBody);
    return data === undefined ? undefined : { [GHOSTHAND_METADATA_KEY]: data };
  },
  createStreamExtractor: () => {
    let cost: number | undefined;
    return {
      processChunk(chunk: unknown): void {
        const data = extractChatMetadata(chunk);
        if (typeof data?.costUsd === "number") cost = data.costUsd;
      },
      buildMetadata: () => (cost === undefined ? undefined : { [GHOSTHAND_METADATA_KEY]: { costUsd: cost } }),
    };
  },
};

const LogprobsMetadata = z.array(
  z.object({
    token: z.string(),
    logprob: z.number(),
    top: z.array(z.object({ token: z.string(), logprob: z.number() })),
  }),
);

/** First-choice token logprobs captured by our extractor, if the server returned any. */
export function logprobsFromMetadata(metadata: ProviderMetadata | undefined): TokenLogprobs[] | undefined {
  const parsed = LogprobsMetadata.safeParse(metadata?.[GHOSTHAND_METADATA_KEY]?.logprobs);
  return parsed.success ? parsed.data : undefined;
}

export function costFromMetadata(metadata: ProviderMetadata | undefined): number | undefined {
  const cost = metadata?.[GHOSTHAND_METADATA_KEY]?.costUsd;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

export interface OpenAICompatibleProviderOptions {
  /** Catalog provider id, e.g. `ollama`, `lmstudio`, `vllm`. Also the provider-options key. */
  readonly id: string;
  /** Root that serves `/chat/completions` and `/models`, e.g. `http://127.0.0.1:11434/v1`. */
  readonly baseURL: string;
  /** Local servers usually need none. */
  readonly apiKey?: string | undefined;
  readonly headers?: Record<string, string>;
  /** Sends `response_format: json_schema` for structured output. Default true. */
  readonly supportsStructuredOutputs?: boolean;
  readonly fetch?: typeof globalThis.fetch;
  /** Extra body fields for every call, under the provider id. */
  readonly callOptions?: ProviderCallOptions;
}

/** Builds the provider without fixing its kind; `openai-compatible` and `openrouter` share this. */
function chatProvider(
  options: OpenAICompatibleProviderOptions,
  kind: "openai-compatible" | "openrouter",
  configured: boolean,
): ModelProvider {
  const apiKey = options.apiKey?.trim();
  const sdk = createOpenAICompatible({
    name: options.id,
    baseURL: options.baseURL,
    supportsStructuredOutputs: options.supportsStructuredOutputs ?? true,
    includeUsage: true,
    metadataExtractor,
    ...(apiKey ? { apiKey } : {}),
    ...(options.headers !== undefined ? { headers: options.headers } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });
  return {
    id: options.id,
    kind,
    configured,
    languageModel: (modelId: string): SdkLanguageModel => sdk.chatModel(modelId),
    reportedCostUsd: costFromMetadata,
    ...(options.callOptions !== undefined ? { callOptions: options.callOptions } : {}),
  };
}

/** A local or self-hosted server. Configured whenever it has a base URL; reachability is discovery's job. */
export function createOpenAICompatibleProvider(options: OpenAICompatibleProviderOptions): ModelProvider {
  return chatProvider(options, "openai-compatible", options.baseURL.trim() !== "");
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterProviderOptions {
  readonly apiKey?: string | undefined;
  readonly baseURL?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Catalog provider id; defaults to `openrouter`. */
  readonly id?: string;
}

/** OpenRouter chat models over its OpenAI-compatible API, with `usage.cost` read from each response. */
export function createOpenRouterProvider(options: OpenRouterProviderOptions = {}): ModelProvider {
  const apiKey = options.apiKey?.trim() ?? "";
  const id = options.id ?? "openrouter";
  return chatProvider(
    {
      id,
      baseURL: options.baseURL ?? OPENROUTER_BASE_URL,
      apiKey,
      // App attribution headers documented by OpenRouter.
      headers: { "X-Title": "GhostHand", "HTTP-Referer": "https://github.com/ramifara/ghosthand" },
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      // Usage accounting adds `usage.cost` (USD) to the response.
      callOptions: { [id]: { usage: { include: true } } },
    },
    "openrouter",
    apiKey.length > 0,
  );
}
