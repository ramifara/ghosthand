// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { testBuiltin, testCatalog, testSnapshot } from "../__fixtures__/test-catalog.ts";
import { createModelCatalog } from "./model-catalog.ts";

describe("createModelCatalog", () => {
  it("maps snapshot fields", () => {
    const fast = testCatalog().get("openai/fast-json");
    expect(fast).toEqual({
      ref: "openai/fast-json",
      provider: "openai",
      id: "fast-json",
      name: "Fast JSON",
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      contextTokens: 400_000,
      maxOutputTokens: 32_000,
      pricing: { inputPerM: 0.1, outputPerM: 0.5, cacheReadPerM: 0.01 },
      toolCall: true,
      structuredOutput: true,
      reasoning: true,
      releaseDate: "2026-09-22",
      grounding: "none",
      sources: ["models.dev"],
    });
  });

  it("treats a missing structured_output flag as false", () => {
    expect(testCatalog().get("openai/text-only")?.structuredOutput).toBe(false);
  });

  it("applies built-in GhostHand fields", () => {
    const big = testCatalog().get("openai/big-json");
    expect(big?.computerUse).toBe("openai_computer");
    expect(big?.grounding).toBe("pixels");
    expect(big?.sources).toEqual(["models.dev", "builtin"]);
  });

  it("lists models sorted by ref and providers with env names", () => {
    const catalog = testCatalog();
    expect(catalog.list().map((m) => m.ref)).toEqual([
      "anthropic/claude-x",
      "openai/big-json",
      "openai/fast-json",
      "openai/small-ctx",
      "openai/text-only",
    ]);
    expect(catalog.provider("openai")?.env).toEqual(["OPENAI_API_KEY"]);
    expect(catalog.source).toBe("test");
  });

  it("merges overrides field by field", () => {
    const catalog = testCatalog([
      { ref: "openai/text-only", structuredOutput: true, latencyP50Ms: 420, pricing: { outputPerM: 3 } },
      { ref: "openai/big-json", computerUse: null, grounding: "norm1000" },
    ]);
    const text = catalog.get("openai/text-only");
    expect(text?.structuredOutput).toBe(true);
    expect(text?.latencyP50Ms).toBe(420);
    expect(text?.pricing).toEqual({ inputPerM: 1, outputPerM: 3 });
    expect(text?.contextTokens).toBe(128_000);
    expect(text?.sources).toEqual(["models.dev", "override"]);
    const big = catalog.get("openai/big-json");
    expect(big?.computerUse).toBeUndefined();
    expect(big?.grounding).toBe("norm1000");
    expect(big?.sources).toEqual(["models.dev", "builtin", "override"]);
  });

  it("adds models and providers that only exist in overrides", () => {
    const catalog = testCatalog([
      {
        ref: "lmstudio/qwen3-vl-8b",
        name: "Qwen3 VL 8B (local)",
        inputModalities: ["text", "image"],
        contextTokens: 32_768,
        structuredOutput: true,
        grounding: "norm1000",
      },
    ]);
    const local = catalog.get("lmstudio/qwen3-vl-8b");
    expect(local?.name).toBe("Qwen3 VL 8B (local)");
    expect(local?.pricing).toBeUndefined();
    expect(local?.sources).toEqual(["override"]);
    expect(catalog.provider("lmstudio")).toEqual({ id: "lmstudio", name: "lmstudio", env: [] });
  });

  it("ignores a partial price for an unpriced new model", () => {
    const catalog = testCatalog([{ ref: "local/m", pricing: { inputPerM: 1 } }]);
    expect(catalog.get("local/m")?.pricing).toBeUndefined();
  });

  it("rejects invalid overrides with a path", () => {
    const bad = createModelCatalog({
      snapshot: testSnapshot,
      builtin: testBuiltin,
      overrides: [{ ref: "openai/fast-json" }, { ref: "no-slash" }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.path).toBe("overrides.1.ref");
    const unknownField = createModelCatalog({
      snapshot: testSnapshot,
      overrides: [{ ref: "a/b", speed: 1 }],
    });
    expect(unknownField.ok).toBe(false);
    const badKind = createModelCatalog({
      snapshot: testSnapshot,
      overrides: [{ ref: "a/b", computerUse: "x" }],
    });
    expect(badKind.ok).toBe(false);
  });

  it("rejects a malformed snapshot", () => {
    const bad = createModelCatalog({ snapshot: { schemaVersion: 2, providers: {} } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.kind).toBe("invalid");
  });

  it("loads the bundled snapshot by default with built-in fields", () => {
    const catalog = createModelCatalog();
    if (!catalog.ok) throw new Error(catalog.error.message);
    const astra = catalog.value.get("openai/gpt-6-astra");
    expect(astra?.computerUse).toBe("openai_computer");
    expect(astra?.pricing?.inputPerM).toBeGreaterThan(0);
  });
});
