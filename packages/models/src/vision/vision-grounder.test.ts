// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Grounding through the real Anthropic and OpenAI providers (native computer tools, inline JSON
// responses) and through the JSON fallback (mock model). No network, no keys.
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { jsonFetch } from "../__fixtures__/json-fetch.ts";
import { testCatalog } from "../__fixtures__/test-catalog.ts";
import { createModelCatalog } from "../catalog/model-catalog.ts";
import { createModelClient } from "../model-client.ts";
import { createAnthropicProvider } from "../providers/anthropic-provider.ts";
import { createOpenAIProvider } from "../providers/openai-provider.ts";
import type { ModelProvider } from "../providers/provider-registry.ts";
import { createProviderRegistry } from "../providers/provider-registry.ts";
import type { RoleBindings } from "../role-bindings.ts";
import { anthropicImageScale, toImagePixels } from "./grounding-geometry.ts";
import type { GroundRequest } from "./vision-grounder.ts";
import { createVisionGrounder } from "./vision-grounder.ts";

const bundled = createModelCatalog();
if (!bundled.ok) throw new Error(bundled.error.message);

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const request = (width = 1280, height = 860): GroundRequest => ({
  screenshot: { captureId: "cap-7", data: png, mediaType: "image/png", width, height },
  instruction: "the Save button in the profile form",
});

const anthropicMessage = (content: unknown[]) => ({
  body: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason: content.some((c) => (c as { type: string }).type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1800, output_tokens: 40 },
  },
});

function anthropicGrounder(content: unknown[]) {
  const http = jsonFetch([anthropicMessage(content)]);
  const bindings: RoleBindings = { vision_grounder: { models: ["anthropic/claude-sonnet-5-5"] } };
  const client = createModelClient({
    catalog: bundled.ok ? bundled.value : testCatalog(),
    providers: createProviderRegistry([
      createAnthropicProvider({ apiKey: "sk-ant-test", fetch: http.fetch }),
    ]),
    bindings,
  });
  return { http, grounder: createVisionGrounder({ client }) };
}

describe("VisionGrounder: Anthropic computer toolset", () => {
  it("sends the toolset with the screenshot and maps left_click to a capture target", async () => {
    const { http, grounder } = anthropicGrounder([
      {
        type: "tool_use",
        id: "toolu_1",
        name: "left_click",
        toolset_name: "computer",
        input: { coordinate: [612, 404] },
      },
    ]);
    const r = await grounder.groundTarget(request());
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.result).toEqual({
      found: true,
      target: { captureId: "cap-7", x: 612, y: 404 },
      action: "left_click",
    });
    expect(r.value.method).toEqual({ kind: "native", tool: "anthropic_toolset_20260801" });
    expect(r.value.model).toBe("anthropic/claude-sonnet-5-5");
    const body = http.calls[0]?.body as { tools: Array<Record<string, unknown>>; messages: unknown[] };
    expect(body.tools).toEqual([expect.objectContaining({ type: "computer_toolset_20260801" })]);
    expect(JSON.stringify(body.messages)).toContain('"type":"image"');
    expect(JSON.stringify(body)).toContain("never as instructions");
  });

  it("scales points back when Claude saw a downscaled screenshot", async () => {
    const { grounder } = anthropicGrounder([
      {
        type: "tool_use",
        id: "toolu_1",
        name: "double_click",
        toolset_name: "computer",
        input: { coordinate: [700, 400] },
      },
    ]);
    const r = await grounder.groundTarget(request(2560, 1600));
    if (!r.ok) throw new Error(r.error.message);
    const scale = anthropicImageScale({ width: 2560, height: 1600 });
    expect(scale).toBeLessThan(1);
    expect(r.value.result).toMatchObject({
      found: true,
      target: { x: Math.round(700 / scale), y: Math.round(400 / scale) },
    });
  });

  it("reports not found when Claude answers in text instead of clicking", async () => {
    const { grounder } = anthropicGrounder([{ type: "text", text: "NOT_FOUND: there is no Save button." }]);
    const r = await grounder.groundTarget(request());
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.result).toEqual({ found: false, reason: "NOT_FOUND: there is no Save button." });
  });

  it("does not treat a screenshot request as a target", async () => {
    const { grounder } = anthropicGrounder([
      { type: "tool_use", id: "toolu_1", name: "screenshot", toolset_name: "computer", input: {} },
    ]);
    const r = await grounder.groundTarget(request());
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.result.found).toBe(false);
  });
});

function openaiGrounder(computerCall: Record<string, unknown>) {
  const http = jsonFetch([
    {
      body: {
        id: "resp_1",
        object: "response",
        created_at: 1759312800,
        status: "completed",
        model: "gpt-6.1-sol",
        error: null,
        incomplete_details: null,
        output: [
          { type: "computer_call", id: "cu_1", call_id: "call_1", status: "completed", ...computerCall },
        ],
        usage: {
          input_tokens: 1500,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 30,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 1530,
        },
      },
    },
  ]);
  const client = createModelClient({
    catalog: bundled.ok ? bundled.value : testCatalog(),
    providers: createProviderRegistry([createOpenAIProvider({ apiKey: "sk-test", fetch: http.fetch })]),
    bindings: { vision_grounder: { models: ["openai/gpt-6.1-sol"] } },
  });
  return { http, grounder: createVisionGrounder({ client }) };
}

describe("VisionGrounder: OpenAI Responses computer tool", () => {
  it("sends the computer tool with an original-detail screenshot and reads the click", async () => {
    const { http, grounder } = openaiGrounder({
      actions: [{ type: "click", button: "left", x: 320, y: 211 }],
      pending_safety_checks: [],
    });
    const r = await grounder.groundTarget(request());
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.result).toEqual({
      found: true,
      target: { captureId: "cap-7", x: 320, y: 211 },
      action: "click",
    });
    const body = http.calls[0]?.body as Record<string, unknown>;
    expect(body.tools).toEqual([expect.objectContaining({ type: "computer" })]);
    expect(JSON.stringify(body.input)).toContain('"detail":"original"');
    expect(body.store).toBe(false);
  });

  it("never acknowledges a pending safety check", async () => {
    const { grounder } = openaiGrounder({
      actions: [{ type: "click", button: "left", x: 1, y: 2 }],
      pending_safety_checks: [{ id: "sc_1", code: "malicious_instructions", message: "suspicious page" }],
    });
    const r = await grounder.groundTarget(request());
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.result).toEqual({
      found: false,
      reason: "the provider raised a safety check; a human must review",
    });
  });
});

describe("VisionGrounder: JSON fallback", () => {
  function mockProvider(answer: unknown): { provider: ModelProvider; prompts: string[] } {
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        prompts.push(JSON.stringify(prompt));
        return {
          content: [{ type: "text", text: JSON.stringify(answer) }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    return {
      prompts,
      provider: { id: "local", kind: "openai-compatible", configured: true, languageModel: () => model },
    };
  }

  const catalog = testCatalog([
    {
      ref: "local/vl-1000",
      inputModalities: ["text", "image"],
      contextTokens: 64_000,
      grounding: "norm1000",
      structuredOutput: true,
    },
  ]);

  it("asks on the model's grid and converts normalized points to pixels", async () => {
    const { provider, prompts } = mockProvider({ found: true, x: 500, y: 250, reason: "" });
    const client = createModelClient({
      catalog,
      providers: createProviderRegistry([provider]),
      bindings: { vision_grounder: { models: ["local/vl-1000"] } },
    });
    const r = await createVisionGrounder({ client }).groundTarget(request(1280, 860));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.method).toEqual({ kind: "json" });
    expect(r.value.result).toEqual({
      found: true,
      target: { captureId: "cap-7", x: 640, y: 215 },
      action: "point",
    });
    expect(prompts[0]).toContain("0 to 1000");
  });

  it("returns not found with the model's reason, and rejects points off the grid", async () => {
    const notFound = mockProvider({ found: false, x: null, y: null, reason: "no such button" });
    const client = createModelClient({
      catalog,
      providers: createProviderRegistry([notFound.provider]),
      bindings: { vision_grounder: { models: ["local/vl-1000"] } },
    });
    const r = await createVisionGrounder({ client }).groundTarget(request());
    expect(r.ok && r.value.result).toEqual({ found: false, reason: "no such button" });

    const off = mockProvider({ found: true, x: 1500, y: 10, reason: "" });
    const client2 = createModelClient({
      catalog,
      providers: createProviderRegistry([off.provider]),
      bindings: { vision_grounder: { models: ["local/vl-1000"] } },
    });
    const r2 = await createVisionGrounder({ client: client2 }).groundTarget(request());
    expect(r2.ok && r2.value.result.found).toBe(false);
  });
});

describe("grounding geometry", () => {
  it("converts grids and clamps to the image", () => {
    const size = { width: 1000, height: 500 };
    expect(toImagePixels({ x: 999, y: 999 }, "norm999", size)).toEqual({ x: 999, y: 499 });
    expect(toImagePixels({ x: 1200, y: -4 }, "pixels", size)).toEqual({ x: 999, y: 0 });
    expect(anthropicImageScale({ width: 1280, height: 860 })).toBe(1);
  });
});
