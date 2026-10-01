// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { AgentConsultant, ConsultantAskOptions } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { createConsultantWriter, parseWriterHint } from "./consultant-writer.ts";

const input = { instruction: "go", goal: "go", page: "{}", history: [], reason: "target_confidence 0.55" };

function fake(answer: unknown, fail = false): AgentConsultant & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    id: "codex",
    prompts,
    probe: async () => ({ installed: true, auth: "chatgpt", models: [] }),
    open: async () =>
      ok({
        ask: async <T>(o: ConsultantAskOptions<T>) => {
          prompts.push(o.prompt);
          if (fail) return err({ kind: "timeout" as const, message: "slow" });
          try {
            return ok(o.parse(answer));
          } catch (e) {
            return err({ kind: "schema_failed" as const, message: String(e) });
          }
        },
        rateLimits: async () => ok({}),
        interrupt: async () => {},
        close: async () => {},
      }),
  };
}

describe("consultant writer", () => {
  it("parses hints strictly", () => {
    expect(parseWriterHint({ kind: "focus", content: "Press Next" })).toEqual({
      kind: "focus",
      focus: "Press Next",
    });
    expect(() => parseWriterHint({ kind: "click", content: "e5" })).toThrow();
  });
  it("returns a focus hint and passes the reason in the prompt", async () => {
    const c = fake({ kind: "focus", content: "Press the page 2 button" });
    const r = await createConsultantWriter(c).hint(input);
    expect(r.ok && r.value.hint).toEqual({ kind: "focus", focus: "Press the page 2 button" });
    expect(c.prompts[0]).toContain("target_confidence 0.55");
  });
  it("maps failures", async () => {
    const t = await createConsultantWriter(fake({}, true)).hint(input);
    expect(!t.ok && t.error.kind).toBe("timeout");
    const bad = await createConsultantWriter(fake({ kind: "x", content: "y" })).hint(input);
    expect(!bad.ok && bad.error.kind).toBe("invalid");
  });
});
