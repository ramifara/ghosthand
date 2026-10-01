// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The real `@ai-sdk/openai` Responses provider against recorded HTTP responses. No network, no key.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createModelCatalog } from "../catalog/model-catalog.ts";
import { createModelClient } from "../model-client.ts";
import type { RecordedFetch } from "../recorded-fetch.ts";
import { failingFetch, hangingFetch, recordedFetch } from "../recorded-fetch.ts";
import type { RoleBindings } from "../role-bindings.ts";
import { createOpenAIProvider } from "./openai-provider.ts";
import { createProviderRegistry } from "./provider-registry.ts";

const Plan = z.object({
  subgoals: z
    .array(z.object({ title: z.string(), done_when: z.string() }))
    .min(1)
    .max(12),
});

const bindings: RoleBindings = {
  planner: { models: ["openai/gpt-6-luna"], reasoningEffort: "low" },
  writer: { models: ["openai/gpt-6-luna"] },
};

const catalogResult = createModelCatalog();
if (!catalogResult.ok) throw new Error(catalogResult.error.message);
const catalog = catalogResult.value;

function clientWith(recorded: RecordedFetch, apiKey = "sk-test-not-a-real-key") {
  return createModelClient({
    catalog,
    providers: createProviderRegistry([createOpenAIProvider({ apiKey, fetch: recorded.fetch })]),
    bindings,
  });
}

const screenshot = {
  data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  mediaType: "image/png",
} as const;

describe("OpenAI Responses provider (recorded)", () => {
  it("sends a strict JSON-schema request with the image and store:false, and prices the usage", async () => {
    const recorded = recordedFetch("responses-plan-ok");
    const r = await clientWith(recorded).generateStructured({
      role: "planner",
      system: "You are the planner.",
      prompt: "Change the display name and save.",
      images: [{ ...screenshot, detail: "high" }],
      schema: Plan,
      schemaName: "plan",
    });
    if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
    expect(r.value.value.subgoals).toHaveLength(3);
    expect(r.value.model).toBe("openai/gpt-6-luna");
    expect(r.value.usage).toMatchObject({
      inputTokens: 1200,
      cacheReadTokens: 200,
      outputTokens: 80,
      reasoningTokens: 16,
    });

    const luna = catalog.get("openai/gpt-6-luna")?.pricing;
    if (!luna) throw new Error("gpt-6-luna has no price in the snapshot");
    const expected =
      (1000 * luna.inputPerM + 200 * (luna.cacheReadPerM ?? luna.inputPerM) + 80 * luna.outputPerM) / 1e6;
    expect(r.value.costUsd).toBeCloseTo(expected, 12);

    expect(recorded.calls).toHaveLength(1);
    const call = recorded.calls[0];
    expect(call?.url).toBe("https://api.openai.com/v1/responses");
    expect(call?.headers.authorization).toBe("Bearer sk-test-not-a-real-key");
    const body = call?.body as Record<string, unknown>;
    expect(body.model).toBe("gpt-6-luna");
    expect(body.store).toBe(false);
    expect(body.reasoning).toMatchObject({ effort: "low" });
    expect(body.text).toMatchObject({ format: { type: "json_schema", name: "plan" } });
    const input = JSON.stringify(body.input);
    expect(input).toContain('"type":"input_image"');
    expect(input).toContain('"detail":"high"');
    expect(input).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("returns writer text", async () => {
    const r = await clientWith(recordedFetch("responses-hint-ok")).generateText({
      role: "writer",
      prompt: "hint",
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.value).toContain("Display name");
  });

  it.each([
    ["responses-plan-not-json", "schema_failed"],
    ["responses-plan-wrong-shape", "schema_failed"],
    ["responses-plan-truncated", "schema_failed"],
    ["responses-content-filter", "refused"],
  ] as const)("%s → %s", async (name, kind) => {
    const r = await clientWith(recordedFetch(name)).generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe(kind);
  });

  it.each([
    ["error-400", "unknown", 400],
    ["error-401", "auth", 401],
    ["error-403", "auth", 403],
    ["error-404", "not_configured", 404],
    ["error-429", "rate_limit", 429],
    ["error-500", "server", 500],
    ["error-503", "server", 503],
  ] as const)("%s → %s", async (name, kind, status) => {
    const r = await clientWith(recordedFetch(name)).generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe(kind);
    expect(r.error.status).toBe(status);
    expect(r.error.model).toBe("openai/gpt-6-luna");
    if (kind === "rate_limit") expect(r.error.retryAfterMs).toBe(1200);
  });

  it("maps a connection failure to network", async () => {
    const r = await clientWith(failingFetch()).generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
    });
    expect(!r.ok && r.error.kind).toBe("network");
  });

  it("times out a hanging request", async () => {
    const r = await clientWith(hangingFetch()).generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
      timeoutMs: 25,
    });
    expect(!r.ok && r.error.kind).toBe("timeout");
  });

  it("aborts a hanging request on the caller's signal", async () => {
    const controller = new AbortController();
    const pending = clientWith(hangingFetch()).generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    const r = await pending;
    expect(!r.ok && r.error.kind).toBe("aborted");
  });

  it("never calls the network without a key", async () => {
    const recorded = recordedFetch("responses-plan-ok");
    const r = await clientWith(recorded, "  ").generateStructured({
      role: "planner",
      prompt: "p",
      schema: Plan,
    });
    expect(!r.ok && r.error.kind).toBe("not_configured");
    expect(recorded.calls).toHaveLength(0);
  });

  it("reports configuration state", () => {
    expect(createOpenAIProvider({ apiKey: "sk-x" }).configured).toBe(true);
    expect(createOpenAIProvider({}).configured).toBe(false);
    expect(createOpenAIProvider({ id: "openai-work", apiKey: "sk-x" }).id).toBe("openai-work");
  });
});
