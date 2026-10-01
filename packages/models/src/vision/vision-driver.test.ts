// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// D2 driving through the real Anthropic and OpenAI providers (recorded-style JSON responses) and the JSON
// fallback (mock model). No network, no keys.
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { jsonFetch } from "../__fixtures__/json-fetch.ts";
import { testCatalog } from "../__fixtures__/test-catalog.ts";
import { createModelCatalog } from "../catalog/model-catalog.ts";
import { createModelClient } from "../model-client.ts";
import { createAnthropicProvider } from "../providers/anthropic-provider.ts";
import { createOpenAIProvider } from "../providers/openai-provider.ts";
import { createProviderRegistry } from "../providers/provider-registry.ts";
import {
  createVisionDriver,
  type DriveRequest,
  readAnthropicDrive,
  readOpenAIDrive,
} from "./vision-driver.ts";

const bundled = createModelCatalog();
if (!bundled.ok) throw new Error(bundled.error.message);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const req: DriveRequest = {
  screenshot: { captureId: "cap-3", data: png, mediaType: "image/png", width: 1280, height: 860 },
  goal: "Connect to the remote host",
  history: ["opened the viewer"],
};
const out = (input: unknown, text = "") => ({
  toolCalls: [{ toolName: "computer", input }],
  text,
  providerMetadata: undefined,
});

describe("readAnthropicDrive", () => {
  it("maps clicks, typing, keys, scrolls and drags", () => {
    expect(readAnthropicDrive(out({ action: "left_click", coordinate: [5, 6] }), "computer")).toEqual({
      ok: true,
      value: { kind: "click", x: 5, y: 6 },
    });
    expect(readAnthropicDrive(out({ action: "double_click", coordinate: [1, 2] }), "computer")).toMatchObject(
      {
        value: { kind: "click", count: 2 },
      },
    );
    expect(readAnthropicDrive(out({ action: "type", text: "hello" }), "computer")).toMatchObject({
      value: { kind: "type", text: "hello" },
    });
    expect(readAnthropicDrive(out({ action: "key", text: "ctrl+a" }), "computer")).toMatchObject({
      value: { kind: "key", keys: ["ctrl", "a"] },
    });
    expect(
      readAnthropicDrive(
        out({ action: "scroll", coordinate: [9, 9], scroll_direction: "down", scroll_amount: 2 }),
        "computer",
      ),
    ).toMatchObject({ value: { kind: "scroll", dx: 0, dy: 200 } });
    expect(
      readAnthropicDrive(
        out({ action: "left_click_drag", start_coordinate: [1, 1], coordinate: [8, 8] }),
        "computer",
      ),
    ).toMatchObject({ value: { kind: "drag", from: { x: 1, y: 1 }, to: { x: 8, y: 8 } } });
  });

  it("treats no tool call or an unsupported action as done", () => {
    expect(
      readAnthropicDrive({ toolCalls: [], text: "DONE: connected", providerMetadata: undefined }, "computer"),
    ).toEqual({ ok: true, value: { kind: "done", reason: "DONE: connected" } });
    expect(readAnthropicDrive(out({ action: "screenshot" }), "computer")).toMatchObject({
      value: { kind: "done" },
    });
  });
});

describe("readOpenAIDrive", () => {
  it("returns safety for pending safety checks and never acknowledges them", () => {
    const r = readOpenAIDrive(
      out({
        actions: [{ type: "click", x: 1, y: 1 }],
        pendingSafetyChecks: [{ id: "sc", code: "malicious_instructions" }],
      }),
      "computer",
    );
    expect(r).toEqual({
      ok: true,
      value: { kind: "safety", reason: "the provider raised a safety check; a human must review" },
    });
  });

  it("maps keypress and drag paths", () => {
    expect(
      readOpenAIDrive(out({ actions: [{ type: "keypress", keys: ["ENTER"] }] }), "computer"),
    ).toMatchObject({
      value: { kind: "key", keys: ["ENTER"] },
    });
    expect(
      readOpenAIDrive(
        out({
          actions: [
            {
              type: "drag",
              path: [
                { x: 1, y: 2 },
                { x: 3, y: 4 },
                { x: 5, y: 6 },
              ],
            },
          ],
        }),
        "computer",
      ),
    ).toMatchObject({ value: { kind: "drag", from: { x: 1, y: 2 }, to: { x: 5, y: 6 } } });
  });
});

describe("createVisionDriver", () => {
  it("drives through the Anthropic toolset and scales points back to capture pixels", async () => {
    const http = jsonFetch([
      {
        body: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "left_click",
              toolset_name: "computer",
              input: { coordinate: [100, 50] },
            },
          ],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 1800, output_tokens: 40 },
        },
      },
    ]);
    const client = createModelClient({
      catalog: bundled.ok ? bundled.value : testCatalog(),
      providers: createProviderRegistry([
        createAnthropicProvider({ apiKey: "sk-ant-test", fetch: http.fetch }),
      ]),
      bindings: { vision_grounder: { models: ["anthropic/claude-sonnet-5-5"] } },
    });
    const r = await createVisionDriver({ client }).next(req);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.action).toEqual({ kind: "click", x: 100, y: 50 });
    expect(JSON.stringify(http.calls[0]?.body)).toContain("Connect to the remote host");
  });

  it("reports an OpenAI safety check instead of acting", async () => {
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
            {
              type: "computer_call",
              id: "cu_1",
              call_id: "call_1",
              status: "completed",
              actions: [{ type: "click", button: "left", x: 3, y: 4 }],
              pending_safety_checks: [{ id: "sc_1", code: "malicious_instructions", message: "suspicious" }],
            },
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
    const r = await createVisionDriver({ client }).next(req);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.action.kind).toBe("safety");
  });

  it("uses a JSON answer on the model's grid without a native tool", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              action: "click",
              x: 500,
              y: 500,
              to_x: null,
              to_y: null,
              text: null,
              reason: "",
            }),
          },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    const client = createModelClient({
      catalog: testCatalog([
        {
          ref: "local/vl-1000",
          inputModalities: ["text", "image"],
          contextTokens: 64_000,
          grounding: "norm1000",
          structuredOutput: true,
        },
      ]),
      providers: createProviderRegistry([
        { id: "local", kind: "openai-compatible", configured: true, languageModel: () => model },
      ]),
      bindings: { vision_grounder: { models: ["local/vl-1000"] } },
    });
    const r = await createVisionDriver({ client }).next(req);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.action).toEqual({ kind: "click", x: 640, y: 430 });
  });
});
