// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { testCatalog } from "./__fixtures__/test-catalog.ts";
import { formatTokens, modelsListCommand } from "./models-list-command.ts";
import { localModelOverrides } from "./providers/local-discovery.ts";

describe("modelsListCommand", () => {
  it("lists callable providers, newest first, with role badges and key state", () => {
    const out = modelsListCommand({ catalog: testCatalog(), env: { OPENAI_API_KEY: "sk-secret-value" } });
    expect(out.data.map((e) => e.ref)).toEqual([
      "anthropic/claude-x",
      "openai/big-json",
      "openai/fast-json",
      "openai/text-only",
      "openai/small-ctx",
    ]);
    const big = out.data[1];
    expect(big?.roles).toEqual(["planner", "writer", "vision_reviewer", "vision_grounder", "judge"]);
    expect(big?.computerUse).toBe("openai_computer");
    expect(big?.key).toBe("set");
    expect(out.data[0]?.key).toBe("missing");
    expect(out.text).toContain("openai/big-json");
    expect(out.text).toMatch(/openai\/big-json\s+1M\s+2\.00\s+10\.00\s+P W VR VG J\s+yes\s+set/);
    expect(out.text).toContain("Catalog: test");
    expect(out.text).not.toContain("sk-secret-value");
  });

  it("shows a missing key and providers without a factory on request", () => {
    const catalog = testCatalog([{ ref: "mystery/m1", contextTokens: 8000 }]);
    const out = modelsListCommand({ catalog, all: true, env: { OPENAI_API_KEY: " " } });
    const keys = Object.fromEntries(out.data.map((e) => [e.ref, e.key]));
    expect(keys["openai/fast-json"]).toBe("missing");
    expect(keys["mystery/m1"]).toBe("unsupported");
    expect(modelsListCommand({ catalog }).data.some((e) => e.provider === "mystery")).toBe(false);
  });

  it("lists discovered local models as local, with no key needed", () => {
    const overrides = localModelOverrides([
      {
        id: "ollama",
        baseURL: "http://127.0.0.1:11434/v1",
        reachable: true,
        models: ["qwen3:8b"],
        latencyMs: 3,
      },
    ]);
    const out = modelsListCommand({
      catalog: testCatalog(overrides),
      localProviders: ["ollama"],
      provider: "ollama",
    });
    expect(out.data).toHaveLength(1);
    expect(out.data[0]).toMatchObject({ ref: "ollama/qwen3:8b", key: "local", roles: ["writer"] });
    expect(out.text).toMatch(/ollama\/qwen3:8b\s+33k\s+0\.00\s+0\.00/);
  });

  it("filters by role and provider", () => {
    const grounders = modelsListCommand({ catalog: testCatalog(), role: "vision_grounder" });
    expect(grounders.data.map((e) => e.ref)).toEqual(["openai/big-json"]);
    const anthropic = modelsListCommand({ catalog: testCatalog(), provider: "anthropic" });
    expect(anthropic.data.map((e) => e.ref)).toEqual(["anthropic/claude-x"]);
    expect(modelsListCommand({ catalog: testCatalog(), provider: "nope" }).text).toBe("No models match.");
  });

  it("uses the bundled catalog by default and covers the Phase 6 providers", () => {
    const out = modelsListCommand({ env: { ANTHROPIC_API_KEY: "sk-ant-test" } });
    const providers = new Set(out.data.map((e) => e.provider));
    expect([...providers].sort()).toEqual(["anthropic", "google", "openai", "openrouter"]);
    expect(out.data.filter((e) => e.provider === "anthropic").every((e) => e.key === "set")).toBe(true);
    expect(out.data.filter((e) => e.provider === "google").every((e) => e.key === "missing")).toBe(true);
    const sonnet = out.data.find((e) => e.ref === "anthropic/claude-sonnet-5-5");
    expect(sonnet?.computerUse).toBe("anthropic_toolset_20260801");
    expect(sonnet?.roles).toContain("vision_grounder");
  });

  it("formats token counts", () => {
    expect(formatTokens(1_050_000)).toBe("1.05M");
    expect(formatTokens(400_000)).toBe("400k");
    expect(formatTokens(512)).toBe("512");
  });
});
