// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Client behaviour over AI SDK mock models: fallback, abort, timeout, budget, cost, logging.
import type { LogFields, Logger } from "@ghosthand/core";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { testCatalog } from "./__fixtures__/test-catalog.ts";
import { ModelCostMeter } from "./cost-meter.ts";
import { createModelClient } from "./model-client.ts";
import type { ModelProvider } from "./providers/provider-registry.ts";
import { createProviderRegistry } from "./providers/provider-registry.ts";
import type { RoleBindings } from "./role-bindings.ts";

const Plan = z.object({
  subgoals: z.array(z.object({ title: z.string(), done_when: z.string() })).min(1),
});
const planJson = JSON.stringify({ subgoals: [{ title: "Open profile", done_when: "URL has /profile" }] });

type Finish = "stop" | "length" | "content-filter";

function generated(text: string, finish: Finish = "stop") {
  return {
    content: text === "" ? [] : [{ type: "text" as const, text }],
    finishReason: { unified: finish, raw: finish },
    usage: {
      inputTokens: { total: 1000, noCache: 800, cacheRead: 200, cacheWrite: undefined },
      outputTokens: { total: 100, text: 90, reasoning: 10 },
    },
    warnings: [],
  };
}

function httpError(statusCode: number): APICallError {
  return new APICallError({
    message: `status ${statusCode}`,
    url: "https://api.openai.com/v1/responses",
    requestBodyValues: {},
    statusCode,
  });
}

const replying = (text: string, finish?: Finish) =>
  new MockLanguageModelV4({ doGenerate: generated(text, finish) });
const failing = (statusCode: number) =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw httpError(statusCode);
    },
  });
const hanging = () =>
  new MockLanguageModelV4({
    doGenerate: ({ abortSignal }) =>
      new Promise((_, reject) => {
        abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
      }),
  });

function provider(
  models: Record<string, MockLanguageModelV4>,
  options: { id?: string; configured?: boolean } = {},
): ModelProvider {
  return {
    id: options.id ?? "openai",
    kind: "openai",
    configured: options.configured ?? true,
    languageModel: (id) => {
      const model = models[id];
      if (!model) throw new Error(`test: no mock for ${id}`);
      return model;
    },
    callOptions: { openai: { store: false } },
  };
}

interface LogLine {
  level: string;
  fields: LogFields;
  msg: string | undefined;
}

function captureLogger(lines: LogLine[], bound: LogFields = {}): Logger {
  const at =
    (level: string) =>
    (fields: LogFields, msg?: string): void => {
      lines.push({ level, fields: { ...bound, ...fields }, msg });
    };
  return {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    child: (b) => captureLogger(lines, { ...bound, ...b }),
  };
}

const bindings: RoleBindings = {
  planner: { models: ["openai/fast-json", "openai/big-json"] },
  writer: { models: ["openai/text-only"] },
  vision_reviewer: { models: ["openai/fast-json"] },
  judge: { models: ["openai/fast-json", "openai/big-json"] },
};

function client(
  models: Record<string, MockLanguageModelV4>,
  extra: Partial<Parameters<typeof createModelClient>[0]> = {},
) {
  return createModelClient({
    catalog: testCatalog(),
    providers: createProviderRegistry([provider(models)]),
    bindings,
    ...extra,
  });
}

describe("generateStructured", () => {
  it("returns the parsed value with model, usage, cost and latency", async () => {
    const fast = replying(planJson);
    const r = await client({ "fast-json": fast }).generateStructured({
      role: "planner",
      prompt: "Plan this",
      system: "You plan.",
      schema: Plan,
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.value.subgoals[0]?.title).toBe("Open profile");
    expect(r.value.model).toBe("openai/fast-json");
    expect(r.value.role).toBe("planner");
    expect(r.value.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 200,
      cacheWriteTokens: 0,
      reasoningTokens: 10,
      totalTokens: 1100,
    });
    // fast-json: $0.10 in, $0.50 out, $0.01 cache read per M.
    expect(r.value.costUsd).toBeCloseTo((800 * 0.1 + 200 * 0.01 + 100 * 0.5) / 1e6, 12);
    expect(r.value.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.value.attempts).toEqual([]);
    const call = fast.doGenerateCalls[0];
    expect(call?.responseFormat?.type).toBe("json");
    expect(call?.providerOptions).toEqual({ openai: { store: false } });
    expect(call?.prompt[0]).toEqual({ role: "system", content: "You plan." });
  });

  it("sends images as file parts with the OpenAI detail option", async () => {
    const fast = replying(planJson);
    await client({ "fast-json": fast }).generateStructured({
      role: "vision_reviewer",
      prompt: "Is the toast visible?",
      images: [{ data: new Uint8Array([137, 80, 78, 71]), mediaType: "image/png", detail: "original" }],
      schema: Plan,
    });
    const user = fast.doGenerateCalls[0]?.prompt.find((m) => m.role === "user");
    expect(user?.content).toEqual([
      { type: "text", text: "Is the toast visible?" },
      {
        type: "file",
        mediaType: "image/png",
        data: { type: "data", data: new Uint8Array([137, 80, 78, 71]) },
        providerOptions: { openai: { imageDetail: "original" } },
      },
    ]);
  });

  it("passes reasoning effort, token limit and timeout from the binding", async () => {
    const fast = replying(planJson);
    const c = client(
      { "fast-json": fast },
      {
        bindings: {
          planner: { models: ["openai/fast-json"], reasoningEffort: "low", maxOutputTokens: 2000 },
        },
      },
    );
    await c.generateStructured({ role: "planner", prompt: "p", schema: Plan });
    const call = fast.doGenerateCalls[0];
    expect(call?.providerOptions).toEqual({ openai: { store: false, reasoningEffort: "low" } });
    expect(call?.maxOutputTokens).toBe(2000);
  });

  it("fails with schema_failed when the output does not match", async () => {
    const r = await client({
      "fast-json": replying(JSON.stringify({ steps: [] })),
      "big-json": replying("not json"),
    }).generateStructured({ role: "planner", prompt: "p", schema: Plan });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("schema_failed");
    expect(r.error.attempts?.map((a) => [a.model, a.kind])).toEqual([
      ["openai/fast-json", "schema_failed"],
      ["openai/big-json", "schema_failed"],
    ]);
  });

  it("charges the meter for tokens spent on a failed parse", async () => {
    const meter = new ModelCostMeter({ capUsd: 1 });
    await client(
      { "fast-json": replying("nope") },
      { costMeter: meter, bindings: { planner: { models: ["openai/fast-json"] } } },
    ).generateStructured({ role: "planner", prompt: "p", schema: Plan });
    expect(meter.calls).toBe(1);
    expect(meter.spentUsd).toBeGreaterThan(0);
  });

  it("falls back to the next model on rate_limit", async () => {
    const big = replying(planJson);
    const lines: LogLine[] = [];
    const r = await client(
      { "fast-json": failing(429), "big-json": big },
      { logger: captureLogger(lines) },
    ).generateStructured({ role: "planner", prompt: "p", schema: Plan });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.model).toBe("openai/big-json");
    expect(r.value.attempts.map((a) => [a.model, a.kind])).toEqual([["openai/fast-json", "rate_limit"]]);
    expect(big.doGenerateCalls).toHaveLength(1);
    expect(lines.map((l) => [l.level, l.msg, l.fields.model])).toEqual([
      ["warn", "model.call failed", "openai/fast-json"],
      ["info", "model.call", "openai/big-json"],
    ]);
  });

  it.each([
    [401, "auth"],
    [404, "not_configured"],
    [500, "server"],
    [503, "server"],
  ] as const)("falls back after HTTP %i (%s)", async (status, kind) => {
    const r = await client({
      "fast-json": failing(status),
      "big-json": replying(planJson),
    }).generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.attempts[0]?.kind).toBe(kind);
  });

  it("returns the last error with every attempt when the whole chain fails", async () => {
    const r = await client({ "fast-json": failing(429), "big-json": failing(503) }).generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({ kind: "server", status: 503, role: "planner", model: "openai/big-json" });
    expect(r.error.attempts?.map((a) => a.kind)).toEqual(["rate_limit", "server"]);
  });

  it("does not route around a refusal", async () => {
    const big = replying(planJson);
    const r = await client({
      "fast-json": replying("", "content-filter"),
      "big-json": big,
    }).generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
    });
    expect(!r.ok && r.error.kind).toBe("refused");
    expect(big.doGenerateCalls).toHaveLength(0);
  });

  it("times out an attempt and moves on", async () => {
    const r = await client({ "fast-json": hanging(), "big-json": replying(planJson) }).generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
      timeoutMs: 20,
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.attempts.map((a) => a.kind)).toEqual(["timeout"]);
  });

  it("stops the chain when the caller aborts", async () => {
    const big = replying(planJson);
    const controller = new AbortController();
    const pending = client({ "fast-json": hanging(), "big-json": big }).generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    const r = await pending;
    expect(!r.ok && r.error.kind).toBe("aborted");
    expect(big.doGenerateCalls).toHaveLength(0);
  });

  it("fails fast on an already aborted signal", async () => {
    const fast = replying(planJson);
    const r = await client({ "fast-json": fast }).generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
      signal: AbortSignal.abort(),
    });
    expect(!r.ok && r.error.kind).toBe("aborted");
    expect(fast.doGenerateCalls).toHaveLength(0);
  });

  it("skips models whose provider has no key", async () => {
    const c = createModelClient({
      catalog: testCatalog(),
      providers: createProviderRegistry([provider({}, { configured: false })]),
      bindings,
    });
    const r = await c.generateStructured({ role: "planner", prompt: "p", schema: Plan });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("not_configured");
    expect(r.error.attempts?.map((a) => a.kind)).toEqual(["not_configured", "not_configured"]);
  });

  it("uses another provider further down the chain", async () => {
    const claude = replying(planJson);
    const c = createModelClient({
      catalog: testCatalog(),
      providers: createProviderRegistry([
        provider({}, { configured: false }),
        provider({ "claude-x": claude }, { id: "anthropic" }),
      ]),
      bindings: { judge: { models: ["openai/fast-json", "anthropic/claude-x"] } },
    });
    const r = await c.generateStructured({ role: "judge", prompt: "p", schema: Plan });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.model).toBe("anthropic/claude-x");
  });

  it("reports unbound roles, unmet requirements and external roles as not_configured", async () => {
    const c = client({});
    const unbound = await c.generateStructured({ role: "vision_grounder", prompt: "p", schema: Plan });
    expect(!unbound.ok && unbound.error.kind).toBe("not_configured");
    const external = await c.generateStructured({ role: "decision", prompt: "p", schema: Plan });
    expect(!external.ok && external.error.message).toContain("DecisionProvider");
    // The writer's only model takes no images.
    const images = await c.generateText({
      role: "writer",
      prompt: "p",
      images: [{ data: "iVBORw0KGgo=", mediaType: "image/png" }],
    });
    expect(!images.ok && images.error.message).toContain("image_input");
  });

  it("stops at the spend cap before calling", async () => {
    const fast = replying(planJson);
    const meter = new ModelCostMeter({ capUsd: 0 });
    const r = await client({ "fast-json": fast }, { costMeter: meter }).generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
    });
    expect(!r.ok && r.error.kind).toBe("budget");
    expect(fast.doGenerateCalls).toHaveLength(0);
  });

  it("logs role, model, tokens, latency and cost but never the prompt or images", async () => {
    const lines: LogLine[] = [];
    await client({ "fast-json": replying(planJson) }, { logger: captureLogger(lines) }).generateStructured({
      role: "vision_reviewer",
      prompt: "SECRET-PROMPT-TEXT",
      system: "SECRET-SYSTEM-TEXT",
      images: [{ data: "U0VDUkVULUlNQUdF", mediaType: "image/png" }],
      schema: Plan,
    });
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line?.fields).toMatchObject({
      component: "models",
      role: "vision_reviewer",
      model: "openai/fast-json",
      ok: true,
      inputTokens: 1000,
      outputTokens: 100,
      attempt: 1,
    });
    expect(typeof line?.fields.costUsd).toBe("number");
    expect(typeof line?.fields.latencyMs).toBe("number");
    const dump = JSON.stringify(lines);
    expect(dump).not.toContain("SECRET");
    expect(dump).not.toContain("U0VDUkVULUlNQUdF");
  });
});

describe("generateText", () => {
  it("returns text for the writer", async () => {
    const r = await client({ "text-only": replying("Focus the Display name box.") }).generateText({
      role: "writer",
      prompt: "Give one hint",
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.value).toBe("Focus the Display name box.");
    expect(r.value.finishReason).toBe("stop");
    // text-only: $1 in (no cache price, so cached reads at the input price), $2 out.
    expect(r.value.costUsd).toBeCloseTo((1000 * 1 + 100 * 2) / 1e6, 12);
  });

  it("maps a filtered answer to refused", async () => {
    const r = await client({ "text-only": replying("", "content-filter") }).generateText({
      role: "writer",
      prompt: "p",
    });
    expect(!r.ok && r.error.kind).toBe("refused");
  });
});
