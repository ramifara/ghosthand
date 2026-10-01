// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildModelsSnapshot, DEFAULT_SNAPSHOT_SELECTION, isChatModel } from "./build-snapshot.ts";
import { bundledSnapshot } from "./model-catalog.ts";
import { ModelsSnapshot } from "./snapshot-schema.ts";

const chat = {
  name: "GPT Test",
  family: "gpt",
  attachment: true,
  reasoning: true,
  tool_call: true,
  structured_output: true,
  temperature: false,
  release_date: "2026-09-22",
  modalities: { input: ["text", "image", "pdf"], output: ["text"] },
  limit: { context: 1_050_000, input: 922_000, output: 128_000 },
  cost: { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125, tiers: [{ input: 0.2 }] },
  benchmarks: [{ name: "OSWorld", score: 70 }],
  experimental: { modes: { fast: {} } },
};

function api(): Record<string, unknown> {
  return {
    openai: {
      id: "openai",
      name: "OpenAI",
      env: ["OPENAI_API_KEY"],
      npm: "@ai-sdk/openai",
      doc: "https://platform.openai.com/docs/models",
      models: {
        "gpt-test": { id: "gpt-test", ...chat },
        "gpt-old": { id: "gpt-old", ...chat, status: "deprecated" },
        "text-embedding-3-small": {
          id: "text-embedding-3-small",
          name: "Embedding",
          tool_call: false,
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 8191, output: 1536 },
        },
        "gpt-image-2": {
          id: "gpt-image-2",
          name: "Image",
          tool_call: false,
          modalities: { input: ["text", "image"], output: ["text", "image"] },
          limit: { context: 0, output: 0 },
        },
      },
    },
    anthropic: { id: "anthropic", name: "Anthropic", env: ["ANTHROPIC_API_KEY"], models: {} },
    google: { id: "google", name: "Google", env: ["GEMINI_API_KEY"], models: {} },
    openrouter: {
      id: "openrouter",
      name: "OpenRouter",
      env: ["OPENROUTER_API_KEY"],
      api: "https://openrouter.ai/api/v1",
      models: {
        "openai/gpt-test": { id: "openai/gpt-test", ...chat },
        "openai/gpt-ancient": { id: "openai/gpt-ancient", ...chat, release_date: "2024-01-01" },
        "obscure/model": { id: "obscure/model", ...chat },
      },
    },
    "some-other-provider": { id: "x", name: "X", env: [], models: { a: { id: "a", ...chat } } },
  };
}

describe("buildModelsSnapshot", () => {
  it("keeps chat models of the selected providers and trims fields", () => {
    const built = buildModelsSnapshot(api(), { source: "test", generatedAt: "2026-10-01" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const snap = built.value;
    expect(Object.keys(snap.providers)).toEqual(["anthropic", "google", "openai", "openrouter"]);
    expect(Object.keys(snap.providers.openai?.models ?? {})).toEqual(["gpt-test"]);
    expect(snap.providers.openai?.models["gpt-test"]).toEqual({
      name: "GPT Test",
      family: "gpt",
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      limit: { context: 1_050_000, output: 128_000 },
      cost: { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
      tool_call: true,
      structured_output: true,
      reasoning: true,
      release_date: "2026-09-22",
    });
    expect(snap.providers.openai?.doc).toBe("https://platform.openai.com/docs/models");
    expect(snap.providers.openrouter?.api).toBe("https://openrouter.ai/api/v1");
    expect(ModelsSnapshot.safeParse(snap).success).toBe(true);
  });

  it("filters aggregator models by vendor and release date", () => {
    const built = buildModelsSnapshot(api(), { source: "test", generatedAt: "2026-10-01" });
    if (!built.ok) throw new Error(built.error.message);
    expect(Object.keys(built.value.providers.openrouter?.models ?? {})).toEqual(["openai/gpt-test"]);
  });

  it("fails when a selected provider is missing", () => {
    const built = buildModelsSnapshot(
      { openai: api().openai },
      {
        source: "test",
        generatedAt: "x",
        selection: { ...DEFAULT_SNAPSHOT_SELECTION, providers: ["openai", "google"] },
      },
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.message).toContain('"google"');
  });

  it("fails with a path on a malformed model", () => {
    const bad = api();
    const openai = bad.openai as { models: Record<string, unknown> };
    openai.models.broken = { id: "broken", name: 42 };
    const built = buildModelsSnapshot(bad, { source: "test", generatedAt: "x" });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.path).toBe("openai.models.broken");
  });

  it("recognises chat models", () => {
    expect(isChatModel({ id: "a", ...chat })).toBe(true);
    expect(isChatModel({ id: "a", ...chat, tool_call: false })).toBe(false);
    expect(isChatModel({ id: "a", ...chat, modalities: { input: ["text"], output: ["audio"] } })).toBe(false);
  });
});

describe("bundled snapshot", () => {
  it("parses and stays small", () => {
    const snap = bundledSnapshot();
    expect(Object.keys(snap.providers).sort()).toEqual(["anthropic", "google", "openai", "openrouter"]);
    expect(Object.keys(snap.providers.openai?.models ?? {}).length).toBeGreaterThan(10);
    expect(snap.attribution).toContain("models.dev");
    const bytes = readFileSync(join(import.meta.dirname, "models-snapshot.json")).byteLength;
    expect(bytes).toBeLessThan(200 * 1024);
  });

  it("prices every OpenAI model", () => {
    for (const [id, model] of Object.entries(bundledSnapshot().providers.openai?.models ?? {})) {
      expect(model.cost, id).toBeDefined();
    }
  });
});
