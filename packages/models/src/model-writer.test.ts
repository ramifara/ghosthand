// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { err, ok } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import type { ModelClient } from "./model-client.ts";
import { createModelWriter } from "./model-writer.ts";

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

describe("createModelWriter", () => {
  it("returns a focus hint and passes the reason to the model", async () => {
    const c = client({ kind: "focus", content: "Press the Sign in button" });
    const r = await createModelWriter(c).hint(input);
    expect(r.ok && r.value.hint).toEqual({ kind: "focus", focus: "Press the Sign in button" });
    expect(c.prompts[0]).toContain("target_confidence 0.41");
  });
  it("maps schema and provider failures", async () => {
    expect((await createModelWriter(client({ kind: "click", content: "e5" })).hint(input)).ok).toBe(false);
    const t = await createModelWriter(client({}, "timeout")).hint(input);
    expect(!t.ok && t.error.kind).toBe("timeout");
    const a = await createModelWriter(client({}, "auth")).hint(input);
    expect(!a.ok && a.error.kind).toBe("unavailable");
  });
});
