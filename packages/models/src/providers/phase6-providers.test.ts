// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The real Anthropic, Google, OpenRouter and OpenAI-compatible AI SDK providers against inline JSON
// responses: URLs, auth headers, body fields, usage and cost. No network, no keys.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonFetch } from "../__fixtures__/json-fetch.ts";
import { createModelCatalog } from "../catalog/model-catalog.ts";
import { createModelClient } from "../model-client.ts";
import type { RoleBindings } from "../role-bindings.ts";
import { createAnthropicProvider } from "./anthropic-provider.ts";
import { createGoogleProvider } from "./google-provider.ts";
import { localModelOverrides } from "./local-discovery.ts";
import {
  createOpenAICompatibleProvider,
  createOpenRouterProvider,
  extractChatMetadata,
} from "./openai-compatible-provider.ts";
import type { ModelProvider } from "./provider-registry.ts";
import { createProviderRegistry } from "./provider-registry.ts";

const catalogResult = createModelCatalog({
  overrides: localModelOverrides([
    {
      id: "ollama",
      baseURL: "http://127.0.0.1:11434/v1",
      reachable: true,
      models: ["qwen3:8b"],
      latencyMs: 1,
    },
  ]),
});
if (!catalogResult.ok) throw new Error(catalogResult.error.message);
const catalog = catalogResult.value;

function client(provider: ModelProvider, writer: string) {
  const bindings: RoleBindings = { writer: { models: [writer] }, planner: { models: [writer] } };
  return createModelClient({ catalog, providers: createProviderRegistry([provider]), bindings });
}

const chatCompletion = (content: string, usage: Record<string, unknown> = {}) => ({
  id: "gen-1",
  object: "chat.completion",
  created: 1759312800,
  model: "x",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128, ...usage },
});

describe("Anthropic provider", () => {
  it("calls the Messages API with x-api-key and prices the usage from the catalog", async () => {
    const http = jsonFetch([
      {
        body: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: "Focus the Display name field." }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 500, output_tokens: 10 },
        },
      },
    ]);
    const provider = createAnthropicProvider({ apiKey: "sk-ant-test", fetch: http.fetch });
    const r = await client(provider, "anthropic/claude-haiku-4-5").generateText({
      role: "writer",
      prompt: "hint",
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.value).toBe("Focus the Display name field.");
    expect(http.calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(http.calls[0]?.headers["x-api-key"]).toBe("sk-ant-test");
    expect(http.calls[0]?.headers.authorization).toBeUndefined();
    const price = catalog.get("anthropic/claude-haiku-4-5")?.pricing;
    expect(r.value.costUsd).toBeCloseTo(
      ((price?.inputPerM ?? 0) * 500 + (price?.outputPerM ?? 0) * 10) / 1e6,
      12,
    );
  });

  it("is unconfigured without a key and never calls out", async () => {
    const http = jsonFetch([{ body: {} }]);
    const provider = createAnthropicProvider({ apiKey: " ", fetch: http.fetch });
    expect(provider.configured).toBe(false);
    const r = await client(provider, "anthropic/claude-haiku-4-5").generateText({
      role: "writer",
      prompt: "x",
    });
    expect(r.ok ? undefined : r.error.kind).toBe("not_configured");
    expect(http.calls).toHaveLength(0);
  });

  it("offers the 2026-08 computer toolset and the older versioned tool, nothing else", () => {
    const provider = createAnthropicProvider({ apiKey: "k" });
    const display = { width: 1280, height: 860 };
    expect(
      Object.keys(provider.nativeComputerTool?.("anthropic_toolset_20260801", display)?.tools ?? {}),
    ).toEqual(["computer"]);
    expect(provider.nativeComputerTool?.("anthropic_computer_20251124", display)?.toolName).toBe("computer");
    expect(provider.nativeComputerTool?.("openai_computer", display)).toBeUndefined();
  });
});

describe("Google provider", () => {
  it("calls generateContent with x-goog-api-key and a JSON schema for structured output", async () => {
    const http = jsonFetch([
      {
        body: {
          candidates: [
            {
              content: { role: "model", parts: [{ text: '{"answer":"ok"}' }] },
              finishReason: "STOP",
              index: 0,
            },
          ],
          usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 6, totalTokenCount: 306 },
        },
      },
    ]);
    const provider = createGoogleProvider({ apiKey: "g-test", fetch: http.fetch });
    const r = await client(provider, "google/gemini-3.8-flash").generateStructured({
      role: "planner",
      prompt: "plan",
      schema: z.object({ answer: z.string() }),
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.value).toEqual({ answer: "ok" });
    expect(http.calls[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    );
    expect(http.calls[0]?.headers["x-goog-api-key"]).toBe("g-test");
    expect(JSON.stringify(http.calls[0]?.body)).toContain("responseMimeType");
    expect(provider.nativeComputerTool).toBeUndefined();
  });
});

describe("OpenRouter provider", () => {
  it("posts chat completions with the key, asks for usage accounting and uses usage.cost", async () => {
    const http = jsonFetch([{ body: chatCompletion("hint text", { cost: 0.00042 }) }]);
    const provider = createOpenRouterProvider({ apiKey: "sk-or-test", fetch: http.fetch });
    const r = await client(provider, "openrouter/openai/gpt-6-luna").generateText({
      role: "writer",
      prompt: "hint",
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.value).toBe("hint text");
    expect(r.value.costUsd).toBe(0.00042);
    const call = http.calls[0];
    expect(call?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(call?.headers.authorization).toBe("Bearer sk-or-test");
    expect(call?.headers["x-title"]).toBe("GhostHand");
    expect(call?.body).toMatchObject({ model: "openai/gpt-6-luna", usage: { include: true } });
  });

  it("falls back to catalog prices when the response has no cost", async () => {
    const http = jsonFetch([{ body: chatCompletion("x") }]);
    const provider = createOpenRouterProvider({ apiKey: "sk-or-test", fetch: http.fetch });
    const r = await client(provider, "openrouter/openai/gpt-6-luna").generateText({
      role: "writer",
      prompt: "x",
    });
    if (!r.ok) throw new Error(r.error.message);
    const price = catalog.get("openrouter/openai/gpt-6-luna")?.pricing;
    expect(r.value.costUsd).toBeCloseTo(
      ((price?.inputPerM ?? 0) * 120 + (price?.outputPerM ?? 0) * 8) / 1e6,
      12,
    );
  });

  it("maps a 429 to rate_limit", async () => {
    const http = jsonFetch([{ status: 429, body: { error: { message: "slow down", code: 429 } } }]);
    const provider = createOpenRouterProvider({ apiKey: "sk-or-test", fetch: http.fetch });
    const r = await client(provider, "openrouter/openai/gpt-6-luna").generateText({
      role: "writer",
      prompt: "x",
    });
    expect(r.ok ? undefined : r.error.kind).toBe("rate_limit");
  });
});

describe("OpenAI-compatible provider (local)", () => {
  it("calls the configured base URL without auth and costs nothing", async () => {
    const http = jsonFetch([{ body: chatCompletion("local hint") }]);
    const provider = createOpenAICompatibleProvider({
      id: "ollama",
      baseURL: "http://127.0.0.1:11434/v1",
      fetch: http.fetch,
    });
    expect(provider.kind).toBe("openai-compatible");
    const r = await client(provider, "ollama/qwen3:8b").generateText({ role: "writer", prompt: "x" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.value).toBe("local hint");
    expect(r.value.costUsd).toBe(0);
    expect(http.calls[0]?.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(http.calls[0]?.headers.authorization).toBeUndefined();
  });

  it("extracts cost and first-choice logprobs from a raw body", () => {
    expect(
      extractChatMetadata({
        choices: [
          {
            logprobs: {
              content: [{ token: "A", logprob: -0.1, top_logprobs: [{ token: "A", logprob: -0.1 }] }],
            },
          },
        ],
        usage: { cost: 0.001 },
      }),
    ).toEqual({
      costUsd: 0.001,
      logprobs: [{ token: "A", logprob: -0.1, top: [{ token: "A", logprob: -0.1 }] }],
    });
    expect(extractChatMetadata({ choices: [{ message: {} }] })).toBeUndefined();
    expect(extractChatMetadata("nope")).toBeUndefined();
  });
});
