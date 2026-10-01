// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { testCatalog } from "./__fixtures__/test-catalog.ts";
import { createModelCatalog } from "./catalog/model-catalog.ts";
import {
  compatibleRoles,
  DEFAULT_ROLE_BINDINGS,
  defaultRoleBindingsFor,
  parseRoleBindings,
  requirementGaps,
  resolveRoleChain,
  validateBindings,
  validateModelForRole,
} from "./role-bindings.ts";
import { ROLE_REQUIREMENTS } from "./roles.ts";

const catalog = testCatalog();

function gapsOf(ref: string, role: keyof typeof ROLE_REQUIREMENTS): readonly string[] {
  const r = validateModelForRole(catalog, role, ref);
  if (r.ok) return [];
  return r.error.kind === "unmet_requirements" ? r.error.gaps : [r.error.kind];
}

describe("validateModelForRole", () => {
  it("accepts a model that meets the role", () => {
    const r = validateModelForRole(catalog, "planner", "openai/fast-json");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ref).toBe("openai/fast-json");
  });

  it("requires structured output for planner and judge", () => {
    expect(gapsOf("openai/text-only", "planner")).toEqual(["structured_output"]);
    expect(gapsOf("openai/text-only", "judge")).toEqual(["structured_output", "image_input"]);
  });

  it("requires image input for vision roles", () => {
    expect(gapsOf("openai/text-only", "vision_reviewer")).toEqual(["structured_output", "image_input"]);
    expect(gapsOf("openai/fast-json", "vision_reviewer")).toEqual([]);
  });

  it("requires a computer-use tool or grounding convention for the grounder", () => {
    expect(gapsOf("openai/fast-json", "vision_grounder")).toEqual(["computer_use"]);
    expect(gapsOf("openai/big-json", "vision_grounder")).toEqual([]);
    const withGrounding = testCatalog([{ ref: "openai/fast-json", grounding: "norm1000" }]);
    expect(validateModelForRole(withGrounding, "vision_grounder", "openai/fast-json").ok).toBe(true);
  });

  it("requires the minimum context", () => {
    expect(gapsOf("openai/small-ctx", "planner")).toEqual(["context"]);
    expect(gapsOf("openai/small-ctx", "writer")).toEqual(["context"]);
  });

  it("needs image input when the call carries images", () => {
    const r = validateModelForRole(catalog, "writer", "openai/text-only", { needsImages: true });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "unmet_requirements") expect(r.error.gaps).toEqual(["image_input"]);
  });

  it("reports unknown models and external roles", () => {
    expect(gapsOf("openai/nope", "planner")).toEqual(["unknown_model"]);
    const decision = validateModelForRole(catalog, "decision", "openai/fast-json");
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.error.kind).toBe("external_role");
      expect(decision.error.message).toContain("DecisionProvider");
    }
    const speech = validateModelForRole(catalog, "speech", "openai/fast-json");
    expect(!speech.ok && speech.error.kind).toBe("external_role");
  });

  it("lists compatible roles", () => {
    const fast = catalog.get("openai/fast-json");
    const big = catalog.get("openai/big-json");
    if (!fast || !big) throw new Error("fixture");
    expect(compatibleRoles(fast)).toEqual(["planner", "writer", "vision_reviewer", "judge"]);
    expect(compatibleRoles(big)).toEqual([
      "planner",
      "writer",
      "vision_reviewer",
      "vision_grounder",
      "judge",
    ]);
    expect(requirementGaps(fast, ROLE_REQUIREMENTS.writer)).toEqual([]);
  });
});

describe("bindings", () => {
  it("parses config and rejects bad refs", () => {
    expect(parseRoleBindings({ planner: { models: ["openai/fast-json"], timeoutMs: 5000 } }).ok).toBe(true);
    const bad = parseRoleBindings({ planner: { models: ["fast-json"] } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.kind === "invalid" && bad.error.path).toBe("planner.models.0");
    expect(parseRoleBindings({ planner: { models: [] } }).ok).toBe(false);
    expect(parseRoleBindings({ decision: { models: ["openai/fast-json"] } }).ok).toBe(false);
  });

  it("validates every model in every chain", () => {
    const r = validateBindings(catalog, {
      planner: { models: ["openai/fast-json", "openai/text-only"] },
      vision_grounder: { models: ["openai/nope"] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.map((e) => e.kind)).toEqual(["unmet_requirements", "unknown_model"]);
  });

  it("default bindings are valid against the bundled catalog", () => {
    const bundled = createModelCatalog();
    if (!bundled.ok) throw new Error(bundled.error.message);
    const r = validateBindings(bundled.value, DEFAULT_ROLE_BINDINGS);
    expect(r.ok ? [] : r.error.map((e) => e.message)).toEqual([]);
  });

  it("resolves the usable part of a chain", () => {
    const r = resolveRoleChain(
      catalog,
      { vision_reviewer: { models: ["openai/text-only", "openai/fast-json", "openai/big-json"] } },
      "vision_reviewer",
    );
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.models.map((m) => m.ref)).toEqual(["openai/fast-json", "openai/big-json"]);
    expect(r.value.skipped.map((s) => s.kind)).toEqual(["unmet_requirements"]);
  });

  it("fails when the role is unbound or nothing qualifies", () => {
    const unbound = resolveRoleChain(catalog, {}, "judge");
    expect(!unbound.ok && unbound.error.kind).toBe("unbound");
    const none = resolveRoleChain(catalog, { judge: { models: ["openai/text-only"] } }, "judge");
    expect(!none.ok && none.error.message).toContain("missing structured_output, image_input");
  });
});

describe("defaultRoleBindingsFor", () => {
  const bundled = createModelCatalog();
  if (!bundled.ok) throw new Error(bundled.error.message);

  it("keeps the OpenAI chain first and appends each configured provider", () => {
    const b = defaultRoleBindingsFor(["openai", "anthropic", "google"]);
    expect(b.planner?.models).toEqual([
      ...(DEFAULT_ROLE_BINDINGS.planner?.models ?? []),
      "anthropic/claude-sonnet-5-5",
      "google/gemini-3.8-flash",
    ]);
    expect(b.planner?.reasoningEffort).toBe("low");
  });

  it("binds only configured providers and gives OpenRouter no grounder", () => {
    const b = defaultRoleBindingsFor(["openrouter"]);
    expect(b.vision_grounder).toBeUndefined();
    expect(b.writer?.models).toEqual(["openrouter/openai/gpt-6-luna"]);
    expect(defaultRoleBindingsFor([])).toEqual({});
  });

  it("only names catalog models that can serve their role", () => {
    const all = defaultRoleBindingsFor(["openai", "anthropic", "google", "openrouter"]);
    expect(bundled.ok && validateBindings(bundled.value, all)).toEqual({ ok: true, value: undefined });
  });
});
