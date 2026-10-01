// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { ANTI_INJECTION, buildCandidates, describeElement, emptyCandidates } from "@ghosthand/core";
import {
  type ChoiceQuestion,
  type Element,
  MAX_CHOICE_OPTIONS,
  Questions,
  VOICE_VERBS,
} from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { invoicePage } from "./__fixtures__/invoice-page.ts";
import {
  buildIntentQuestion,
  buildTargetQuestion,
  buildVoiceDecision,
  VERB_TEXT,
} from "./intent-questions.ts";

const optionCount = (q: unknown) => Object.keys((q as ChoiceQuestion).criteria).length;

function manyButtons(n: number): Element[] {
  const base = invoicePage().elements.find((e) => e.role === "button") as Element;
  return Array.from({ length: n }, (_, i) => ({
    ...base,
    token: `b${i}`,
    stableId: `sb${i}`,
    name: `Button ${i}`,
  }));
}

describe("Jev question builders (voice)", () => {
  it("the intent choice covers every verb plus none, with the anti-injection suffix", () => {
    const q = buildIntentQuestion();
    expect(Object.keys(q.criteria)).toEqual([...VOICE_VERBS, "none"]);
    expect(VOICE_VERBS.length).toBeGreaterThanOrEqual(40);
    expect(optionCount(q)).toBeLessThanOrEqual(MAX_CHOICE_OPTIONS);
    expect(String(q.instructions)).toContain(ANTI_INJECTION);
    for (const v of VOICE_VERBS) expect(VERB_TEXT[v].length).toBeGreaterThan(10);
  });

  it("target options use core describeElement plus position columns", () => {
    const snap = invoicePage();
    const links = snap.elements.filter((e) => e.role === "link");
    const t = buildTargetQuestion("press", links);
    const first = links[0] as Element;
    expect(t?.question.criteria[first.token]).toContain(describeElement(first));
    expect(t?.question.criteria[first.token]).toContain("link #1");
    expect(t?.question.criteria[(links[2] as Element).token]).toContain("link #3");
    expect(Object.keys(t?.question.criteria ?? {}).slice(-2)).toEqual(["none", "ambiguous"]);
  });

  it("never builds a one-option choice, and caps at 255 options", () => {
    expect(buildTargetQuestion("press", [])).toBeUndefined();
    const one = buildTargetQuestion("press", manyButtons(1));
    expect(optionCount(one?.question)).toBe(3);
    const big = buildTargetQuestion("press", manyButtons(400));
    expect(optionCount(big?.question)).toBe(MAX_CHOICE_OPTIONS);
    expect(big?.offered).toHaveLength(MAX_CHOICE_OPTIONS - 2);
  });

  it("one request validates against the protocol schema; heads only for operations with candidates", () => {
    const snap = invoicePage();
    const req = buildVoiceDecision({
      utterance: "the blue thing",
      page: { title: snap.title, url: snap.url ?? "" },
      candidates: buildCandidates(snap),
      askIntent: true,
      operations: ["press", "set_value", "toggle", "select_option"],
    });
    expect(req).toBeDefined();
    expect(Questions.safeParse(req?.questions).success).toBe(true);
    for (const q of Object.values(req?.questions ?? {})) {
      expect(optionCount(q)).toBeGreaterThanOrEqual(2);
      expect(optionCount(q)).toBeLessThanOrEqual(MAX_CHOICE_OPTIONS);
    }
    expect(req?.state).toEqual({ utterance: "the blue thing", page: { title: "Invoices", url: snap.url } });

    const empty = buildVoiceDecision({
      utterance: "x",
      page: { title: "" },
      candidates: emptyCandidates(),
      askIntent: false,
      operations: ["press"],
    });
    expect(empty).toBeUndefined();
  });

  it("adds badge numbers as a column when badges are shown", () => {
    const [a] = manyButtons(1) as [Element];
    const t = buildTargetQuestion("press", [a], new Map([[a.stableId, 7]]));
    expect(t?.question.criteria[a.token]).toContain("badge 7");
  });
});
