// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// OpenAI through a ChatGPT plan ("Sign in with ChatGPT" plan usage, preview). The SIWC access token is
// sent to the public Responses API at https://api.openai.com/v1, never to ChatGPT's `backend-api`
// (docs/research/notes/codex-subscription.md §1a). SIWC requires `store:false` and `stream:true`, rejects a
// list of parameters and system-role messages, so a fetch adapter rewrites each request and folds the
// event stream back into the plain JSON body the AI SDK expects (`response.completed` carries it).
import { createOpenAI } from "@ai-sdk/openai";
import type { ModelProvider, SdkLanguageModel } from "./provider-registry.ts";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const SIWC_API_BASE = "https://api.openai.com/v1";

/** Parameters the SIWC preview rejects (preview-limitations page). */
export const SIWC_REJECTED_PARAMS: readonly string[] = [
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "prompt",
  "prompt_cache_retention",
  "previous_response_id",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
];

/** The usage-limit error code a plan stream can fail with mid-flight. */
export const SIWC_USAGE_LIMIT_CODE = "subscription_sharing_usage_limit_exceeded";

export interface OpenAIChatGptProviderOptions {
  /** Returns the current SIWC access token (main refreshes it); undefined when signed out. */
  readonly getAccessToken: () => string | undefined;
  readonly fetch?: FetchLike;
  /**
   * Catalog provider id. Defaults to `openai` so `openai/<model>` role bindings work with the plan
   * (the plan serves the same model slugs as the API).
   */
  readonly id?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Rewrites a Responses API request body into the SIWC-allowed shape. Pure; exported for tests. */
export function adaptSiwcRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (!SIWC_REJECTED_PARAMS.includes(k)) out[k] = v;
  out.store = false;
  out.stream = true;
  const input = out.input;
  if (typeof input === "string") {
    out.input = [{ role: "user", content: input }];
  } else if (Array.isArray(input)) {
    out.input = input.map((item: unknown) =>
      isRecord(item) && item.role === "system" ? { ...item, role: "developer" } : item,
    );
  }
  return out;
}

/** Finds the SSE `data:` payloads in a stream body. */
export function parseSseEvents(text: string): unknown[] {
  const events: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      // Ignore keep-alives and partial lines.
    }
  }
  return events;
}

const jsonResponse = (status: number, body: unknown, requestId?: string | null): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(requestId ? { "x-request-id": requestId } : {}) },
  });

/**
 * Folds a SIWC event stream into one JSON response. Only `response.completed` counts as success;
 * `response.failed`, `error` and a stream that ends early become HTTP errors the SDK maps as usual.
 */
export async function collectSiwcStream(res: Response): Promise<Response> {
  const requestId = res.headers.get("x-request-id");
  if (!res.ok) return res;
  const text = await res.text();
  for (const event of parseSseEvents(text)) {
    if (!isRecord(event)) continue;
    if (event.type === "response.completed" && isRecord(event.response)) {
      return jsonResponse(200, event.response, requestId);
    }
    if (event.type === "response.failed" || event.type === "error") {
      const response = isRecord(event.response) ? event.response : undefined;
      const error = (response && isRecord(response.error) ? response.error : undefined) ??
        (isRecord(event.error) ? event.error : undefined) ?? { message: "response failed" };
      const code = typeof error.code === "string" ? error.code : undefined;
      const status = code === SIWC_USAGE_LIMIT_CODE ? 429 : 400;
      return jsonResponse(
        status,
        {
          error: {
            message: typeof error.message === "string" ? error.message : "response failed",
            type: status === 429 ? "rate_limit_error" : "invalid_request_error",
            code: code ?? null,
            param: null,
          },
        },
        requestId,
      );
    }
  }
  return jsonResponse(
    502,
    { error: { message: "stream ended without response.completed", type: "server_error", code: null } },
    requestId,
  );
}

const urlOf = (input: string | URL | Request): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** The fetch the SDK uses: token injection, endpoint guard, body rewrite and stream folding. */
export function createSiwcFetch(
  getAccessToken: () => string | undefined,
  base: FetchLike = fetch,
): FetchLike {
  return async (input, init) => {
    const url = urlOf(input);
    if (!url.startsWith(`${SIWC_API_BASE}/`)) {
      // Defence in depth: plan tokens only ever go to the public API.
      return jsonResponse(400, {
        error: { message: `refusing to send a ChatGPT plan token to ${new URL(url).origin}`, code: null },
      });
    }
    const token = getAccessToken();
    if (!token) {
      return jsonResponse(401, {
        error: { message: "not signed in with ChatGPT", type: "invalid_request_error", code: null },
      });
    }
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    const isResponses = url === `${SIWC_API_BASE}/responses` && (init?.method ?? "GET") === "POST";
    if (!isResponses || typeof init?.body !== "string") return base(url, { ...init, headers });
    let parsed: unknown;
    try {
      parsed = JSON.parse(init.body);
    } catch {
      return base(url, { ...init, headers });
    }
    if (!isRecord(parsed)) return base(url, { ...init, headers });
    headers.set("accept", "text/event-stream");
    const body = JSON.stringify(adaptSiwcRequestBody(parsed));
    return collectSiwcStream(await base(url, { ...init, headers, body }));
  };
}

export function createOpenAIChatGptProvider(options: OpenAIChatGptProviderOptions): ModelProvider {
  const configured = (options.getAccessToken() ?? "").length > 0;
  const sdk = createOpenAI({
    // The real token is injected per request by the adapter; this keeps ambient OPENAI_API_KEY out.
    apiKey: "siwc-token-injected-per-request",
    baseURL: SIWC_API_BASE,
    fetch: createSiwcFetch(options.getAccessToken, options.fetch),
  });
  return {
    id: options.id ?? "openai",
    kind: "openai-chatgpt",
    configured,
    languageModel: (modelId: string): SdkLanguageModel => sdk.responses(modelId),
    callOptions: { openai: { store: false } },
  };
}
