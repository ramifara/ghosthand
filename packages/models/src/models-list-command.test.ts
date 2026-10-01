// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { testCatalog } from "./__fixtures__/test-catalog.ts";
import { formatTokens, modelsListCommand } from "./models-list-command.ts";

describe("modelsListCommand", () => {
  it("lists callable providers, newest first, with role badges and key state", () => {
    const out = modelsListCommand({ catalog: testCatalog(), env: { OPENAI_API_KEY: "sk-secret-value" } });
    expect(out.data.map((e) => e.ref)).toEqual([
      "openai/big-json",
      "openai/fast-json",
      "openai/text-only",
      "openai/small-ctx",
    ]);
    const big = out.data[0];
    expect(big?.roles).toEqual(["planner", "writer", "vision_reviewer", "vision_grounder", "judge"]);
    expect(big?.computerUse).toBe("openai_computer");
    expect(big?.key).toBe("set");
    expect(out.text).toContain("openai/big-json");
    expect(out.text).toMatch(/openai\/big-json\s+1M\s+2\.00\s+10\.00\s+P W VR VG J\s+yes\s+set/);
    expect(out.text).toContain("Catalog: test");
    expect(out.text).not.toContain("sk-secret-value");
  });

  it("shows a missing key and other providers on request", () => {
    const out = modelsListCommand({ catalog: testCatalog(), all: true, env: { OPENAI_API_KEY: " " } });
    const keys = Object.fromEntries(out.data.map((e) => [e.ref, e.key]));
    expect(keys["openai/fast-json"]).toBe("missing");
    expect(keys["anthropic/claude-x"]).toBe("unsupported");
  });

  it("filters by role and provider", () => {
    const grounders = modelsListCommand({ catalog: testCatalog(), role: "vision_grounder" });
    expect(grounders.data.map((e) => e.ref)).toEqual(["openai/big-json"]);
    const anthropic = modelsListCommand({ catalog: testCatalog(), all: true, provider: "anthropic" });
    expect(anthropic.data.map((e) => e.ref)).toEqual(["anthropic/claude-x"]);
    expect(modelsListCommand({ catalog: testCatalog(), provider: "nope" }).text).toBe("No models match.");
  });

  it("uses the bundled catalog by default", () => {
    const out = modelsListCommand();
    expect(out.data.length).toBeGreaterThan(10);
    expect(out.data.every((e) => e.provider === "openai" && e.key === "missing")).toBe(true);
  });

  it("formats token counts", () => {
    expect(formatTokens(1_050_000)).toBe("1.05M");
    expect(formatTokens(400_000)).toBe("400k");
    expect(formatTokens(512)).toBe("512");
  });
});
