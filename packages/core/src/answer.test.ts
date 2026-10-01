// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { Answer, DecisionProvider, Questions, Snapshot } from "@ghosthand/protocol";
import { ok } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { answerPassages, extractAnswer } from "./answer.ts";
import { SecretsRegistry } from "./secrets.ts";
import type { Writer } from "./writer.ts";

const snap: Snapshot = {
  id: "s",
  surface: "web",
  takenAt: 0,
  title: "Reports",
  viewport: { x: 0, y: 0, width: 1, height: 1 },
  elements: [],
  text: "Reports\nRevenue from 2026-01-12 to 2026-01-25\nTotal revenue: $4,312.50\nOrders counted: 14",
  tokenEstimate: 0,
  quality: { elementCount: 0, unnamedInteractive: 0, score: 1 },
  narrowed: false,
};

const picking = (pick: (q: Questions) => string, p = 0.9): DecisionProvider => ({
  id: "fake",
  capabilities: { maxOptions: 255, maxLevels: 10, contextTokens: 64000, zdr: true },
  ask: async (_s, q) => {
    const c = pick(q);
    const a: Answer = { type: "choice", choice: c, confidence: p, probabilities: { [c]: p, none: 1 - p } };
    return ok({
      answers: { answer: a },
      model: "jev",
      provider: "fake",
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: 0.00001,
      latencyMs: 1,
      calibration: "native" as const,
    });
  },
});

const keyOf = (q: Questions, text: string) => {
  const c = q.answer?.type === "choice" ? q.answer.criteria : {};
  return Object.entries(c).find(([, v]) => v === text)?.[0] ?? "none";
};

describe("answer step", () => {
  it("lists fact-like passages first", () => {
    expect(answerPassages(snap)[0]).toMatch(/\d/);
    expect(answerPassages(snap)).toContain("Total revenue: $4,312.50");
  });
  it("returns the passage Jev picks", async () => {
    const r = await extractAnswer("tell me the total revenue", snap, {
      decision: picking((q) => keyOf(q, "Total revenue: $4,312.50")),
      secrets: new SecretsRegistry(),
    });
    expect(r).toMatchObject({ answer: "Total revenue: $4,312.50", by: "decision", decisionCalls: 1 });
  });
  it("falls back to the writer when no passage fits, and redacts secrets", async () => {
    const writer: Writer = {
      id: "w",
      hint: async () =>
        ok({
          hint: { kind: "text", text: "The average is 3.8 (pw hunter22)" },
          model: "m",
          latencyMs: 1,
          costUsd: 0.001,
        }),
    };
    const r = await extractAnswer("average rating?", snap, {
      decision: picking(() => "none"),
      writer,
      secrets: new SecretsRegistry([["PW", "hunter22"]]),
    });
    expect(r).toMatchObject({ by: "writer", modelCalls: 1, answer: "The average is 3.8 (pw [input:PW])" });
  });
  it("gives up without a writer when Jev is unsure", async () => {
    expect(
      await extractAnswer("x", snap, {
        decision: picking((q) => keyOf(q, "Reports"), 0.4),
        secrets: new SecretsRegistry(),
      }),
    ).toBeUndefined();
  });
});
