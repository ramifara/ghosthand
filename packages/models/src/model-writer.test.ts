// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { err, ok } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ModelClient } from "./model-client.ts";
import {
  createModelWriter,
  lenientHint,
  lenientShortlist,
  parseShortlistLine,
  parseWriterLine,
  ShortlistDraft,
  WriterDraft,
} from "./model-writer.ts";

const input = {
  instruction: "Sign in",
  goal: "Sign in",
  page: "{}",
  history: [],
  reason: "target_confidence 0.41",
};

function client(answer: unknown, fail?: "timeout" | "auth"): ModelClient & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    generateText: async () => err({ kind: "unknown", message: "unused" }) as never,
    generateWith: async () => err({ kind: "unknown", message: "unused" }) as never,
    generateStructured: async (req) => {
      prompts.push(req.prompt);
      if (fail) return err({ kind: fail, message: fail }) as never;
      const parsed = req.schema.safeParse(answer);
      if (!parsed.success) return err({ kind: "schema_failed", message: "bad" }) as never;
      return ok({
        value: parsed.data,
        role: "writer",
        model: "openai/gpt-test",
        usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, reasoningTokens: 0 },
        costUsd: 0.0001,
        latencyMs: 700,
        finishReason: "stop",
        attempts: [],
      }) as never;
    },
  };
}

describe("structured drafts are strict-schema safe", () => {
  // OpenAI strict mode rejects a schema whose `required` misses a property; optional fields are nullable.
  it.each([
    ["WriterDraft", WriterDraft],
    ["ShortlistDraft", ShortlistDraft],
  ])("%s requires every property", (_name, schema) => {
    const js = z.toJSONSchema(schema) as { required?: string[]; properties: Record<string, unknown> };
    expect([...(js.required ?? [])].sort()).toEqual(Object.keys(js.properties).sort());
  });
});

describe("createModelWriter", () => {
  it("returns a focus hint and passes the reason to the model", async () => {
    const c = client({ kind: "focus", content: "Press the Sign in button" });
    const r = await createModelWriter(c).hint(input);
    expect(r.ok && r.value.hint).toEqual({ kind: "focus", focus: "Press the Sign in button" });
    expect(c.prompts[0]).toContain("target_confidence 0.41");
  });
  it("falls back to a one-line text answer when the provider cannot follow the JSON schema", async () => {
    const c = client({ kind: "click", content: "e5" });
    const systems: string[] = [];
    c.generateText = (async (req: { system?: string }) => {
      systems.push(req.system ?? "");
      return ok({
        value: 'Here you go:\nFOCUS: Click the "Economy" link',
        role: "writer",
        model: "openai/gpt-test",
        usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, reasoningTokens: 0 },
        costUsd: 0.0001,
        latencyMs: 300,
        finishReason: "stop",
        attempts: [],
      });
    }) as never;
    const r = await createModelWriter(c).hint(input);
    expect(r.ok && r.value.hint).toEqual({ kind: "focus", focus: 'Click the "Economy" link' });
    expect(systems[0]).toContain("FOCUS:");
  });

  it("parses the one-line PICKS form for a shortlist, keeping only known ids", () => {
    const candidates = ['e1 — link "Economy"', 'e2 — link "History"', 'e3 — button "Search"'];
    expect(parseShortlistLine("PICKS: e2, e9, e1 | TEXT: - | NOTE: history first", candidates)).toEqual({
      picks: ["e2", "e1"],
      note: "history first",
    });
    expect(
      parseShortlistLine("Sure!\nPICKS: e3 | TEXT: vegan berlin | NOTE: type then search", candidates),
    ).toEqual({
      picks: ["e3"],
      text: "vegan berlin",
      note: "type then search",
    });
    expect(parseShortlistLine("I would click Economy.", candidates)).toBeUndefined();
  });

  it("reads a hint from JSON, the one-line form, or plain prose", () => {
    expect(lenientHint('{"kind":"focus","content":"Click Economy"}')).toEqual({
      kind: "focus",
      content: "Click Economy",
    });
    expect(lenientHint("TEXT: hello")).toEqual({ kind: "text", content: "hello" });
    expect(lenientHint("Click the “Economy” link in the sidebar.\nIt leads to the article.")).toEqual({
      kind: "focus",
      content: "Click the “Economy” link in the sidebar.",
    });
    expect(lenientHint("None of the links fit the goal.")).toEqual({
      kind: "none",
      content: "None of the links fit the goal.",
    });
    expect(lenientHint("  ")).toBeUndefined();
  });

  it("reads a shortlist from JSON, the PICKS line, or ids mentioned in prose", () => {
    const candidates = ['f1e19s5 — link "bone"', 'f1e22s5 — link "mineral"', 'e3 — button "Search"'];
    expect(
      lenientShortlist('```json\n{"picks":["f1e22s5"],"text":null,"note":"minerals"}\n```', candidates),
    ).toEqual({
      picks: ["f1e22s5"],
      note: "minerals",
    });
    expect(lenientShortlist("I would go with f1e19s5 (bone) first, then e3.", candidates)?.picks).toEqual([
      "f1e19s5",
      "e3",
    ]);
    expect(lenientShortlist("Pick the second one.", candidates)).toBeUndefined();
  });

  it("parses the one-line form and rejects anything else", () => {
    expect(parseWriterLine("TEXT: vegan restaurant berlin")).toEqual({
      kind: "text",
      content: "vegan restaurant berlin",
    });
    expect(parseWriterLine("none: the page has no such control")).toEqual({
      kind: "none",
      content: "the page has no such control",
    });
    expect(parseWriterLine("I would click the link.")).toBeUndefined();
  });

  it("maps schema and provider failures", async () => {
    expect((await createModelWriter(client({ kind: "click", content: "e5" })).hint(input)).ok).toBe(false);
    const t = await createModelWriter(client({}, "timeout")).hint(input);
    expect(!t.ok && t.error.kind).toBe("timeout");
    const a = await createModelWriter(client({}, "auth")).hint(input);
    expect(!a.ok && a.error.kind).toBe("unavailable");
  });
});
