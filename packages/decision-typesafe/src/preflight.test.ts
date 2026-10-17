// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { Question, Questions } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { estimateRequestTokens, estimateTokens, preflight } from "./preflight.ts";
import { TYPESAFE_DIRECT_CAPABILITIES as caps } from "./typesafe-provider.ts";

const options = (n: number): Record<string, string> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`e${i}`, `element ${i}`]));
const levels = (n: number): string[] => Array.from({ length: n }, (_, i) => `level ${i}`);

describe("estimateTokens", () => {
  it("uses characters / 2, rounded up", () => {
    expect(estimateTokens("abcdefg")).toBe(4);
    expect(estimateTokens({ a: 1 })).toBe(Math.ceil('{"a":1}'.length / 2));
  });

  it("sums the state with all questions and with the longest question", () => {
    const q: Questions = {
      a: { type: "noul", instructions: "x".repeat(30) },
      b: { type: "noul", criteria: { true: "yes" } },
    };
    const e = estimateRequestTokens("y".repeat(300), q);
    expect(e.state).toBe(150);
    expect(e.total).toBe(150 + (e.questions.a ?? 0) + (e.questions.b ?? 0));
    expect(e.stateWithLongestQuestion).toBe(150 + (e.questions.a ?? 0));
  });
});

describe("preflight", () => {
  it("accepts 255 options and 10 levels", () => {
    const q: Questions = {
      pick: { type: "choice", criteria: options(255) },
      level: { type: "score", criteria: levels(10) },
    };
    expect(preflight("state", q, caps).ok).toBe(true);
  });

  it("rejects 256 options as invalid", () => {
    const r = preflight("state", { pick: { type: "choice", criteria: options(256) } }, caps);
    expect(r.ok ? undefined : r.error).toMatchObject({
      kind: "invalid",
      message: expect.stringMatching(/256/),
    });
  });

  it("rejects 11 levels as invalid", () => {
    const r = preflight("state", { level: { type: "score", criteria: levels(11) } }, caps);
    expect(r.ok ? undefined : r.error).toMatchObject({
      kind: "invalid",
      message: expect.stringMatching(/11/),
    });
  });

  it("rejects a null score level", () => {
    const q = { type: "score", criteria: ["low", null, "high"] } as unknown as Question;
    const r = preflight("state", { level: q }, caps);
    expect(r.ok ? undefined : r.error).toMatchObject({
      kind: "invalid",
      message: expect.stringMatching(/null/),
    });
  });

  it("rejects fewer than two options or levels", () => {
    expect(preflight("s", { pick: { type: "choice", criteria: { a: null } } }, caps).ok).toBe(false);
    expect(preflight("s", { level: { type: "score", criteria: ["only"] } }, caps).ok).toBe(false);
  });

  it("rejects an empty question set", () => {
    const r = preflight("state", {}, caps);
    expect(r.ok ? undefined : r.error.kind).toBe("invalid");
  });

  it("rejects state + longest question over 32k as too_large", () => {
    const r = preflight("x".repeat(33_000 * 2), { done: { type: "noul", instructions: "done?" } }, caps);
    expect(r.ok ? undefined : r.error).toMatchObject({
      kind: "too_large",
      message: expect.stringMatching(/longest question/),
    });
  });

  it("rejects state + all questions over 64k as too_large", () => {
    // 30k-token state passes the 32k rule with each 1.5k-token question, but 30 of them exceed 64k.
    const q: Questions = {};
    for (let i = 0; i < 30; i++) q[`q${i}`] = { type: "noul", instructions: "z".repeat(2_950) };
    const r = preflight("x".repeat(30_000 * 2), q, caps);
    expect(r.ok ? undefined : r.error).toMatchObject({
      kind: "too_large",
      message: expect.stringMatching(/all questions/),
    });
  });

  it("honours overridden caps", () => {
    const r = preflight(
      "state",
      { pick: { type: "choice", criteria: options(256) } },
      { ...caps, maxOptions: 1000 },
    );
    expect(r.ok).toBe(true);
  });
});

describe("noul shape (SDK 0.7.0 rejects a noul with neither instructions nor a described outcome)", () => {
  const caps = { maxOptions: 255, maxLevels: 10, contextTokens: 64_000, perQuestionContextTokens: 32_000 };
  it("rejects a bare noul before sending", () => {
    const r = preflight("s", { done: { type: "noul" } }, caps);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error).toMatchObject({ kind: "invalid", message: expect.stringMatching(/noul "done"/) });
  });
  it("accepts a noul described only by criteria", () => {
    expect(preflight("s", { done: { type: "noul", criteria: { true: "finished" } } }, caps).ok).toBe(true);
  });
});
