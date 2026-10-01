// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// UX friction: Jev `score` questions (2–10 levels, worst first) over the final page of a case. Reported in
// the rubric only, never decisive for a verdict.
import { ANTI_INJECTION, buildState } from "@ghosthand/core";
import type { DecisionProvider, Questions, ScoreQuestion, Snapshot } from "@ghosthand/protocol";
import type { UxScore } from "./report-schema.ts";

interface UxQuestion {
  key: string;
  question: string;
  levels: string[];
}

export const UX_QUESTIONS: UxQuestion[] = [
  {
    key: "feedback",
    question:
      "How clearly does the page confirm the outcome of the last action in `flow` (a message, a changed value, a new page)?",
    levels: [
      "No visible confirmation or the outcome is contradicted",
      "Weak or ambiguous confirmation",
      "Some confirmation, easy to miss",
      "Clear confirmation",
      "Clear, specific confirmation next to the changed content",
    ],
  },
  {
    key: "labels",
    question: "How well do the labels of the controls on the page say what each one does?",
    levels: [
      "Many controls are unnamed or misleading",
      "Several names are vague",
      "Mostly understandable",
      "Clear names",
      "Clear, specific names throughout",
    ],
  },
  {
    key: "errors",
    question:
      "If the page shows an error or warning, how clearly does it say what went wrong and how to fix it? With no error shown, answer the best level.",
    levels: [
      "An error without any explanation",
      "Explains little, no way forward",
      "Explains the problem but not the fix",
      "Explains problem and fix",
      "No error, or a precise error next to the field with the fix",
    ],
  },
];

export function uxQuestions(): Questions {
  const out: Questions = {};
  for (const q of UX_QUESTIONS) {
    const score: ScoreQuestion = {
      type: "score",
      instructions: `${q.question} ${ANTI_INJECTION}`,
      criteria: q.levels,
    };
    out[`ux_${q.key}`] = score;
  }
  return out;
}

export async function reviewUx(
  decision: DecisionProvider | undefined,
  snapshot: Snapshot | undefined,
  flow: string[],
  opts: { signal?: AbortSignal } = {},
): Promise<{ scores: UxScore[]; costUsd: number; inputTokens: number }> {
  const none = (detail: string) => ({
    scores: UX_QUESTIONS.map((q) => ({ key: q.key, question: q.question, detail })),
    costUsd: 0,
    inputTokens: 0,
  });
  if (!decision) return none("no decision provider");
  if (!snapshot) return none("no final snapshot");
  const state = {
    flow,
    ...buildState({
      instruction: flow.join(" "),
      goal: "Review the user experience of this flow",
      step: 0,
      phase: "verify",
      snapshot,
      history: [],
      inputs: [],
    }),
  };
  const r = await decision.ask(state, uxQuestions(), opts.signal ? { signal: opts.signal } : {});
  if (!r.ok) return none(`${r.error.kind}: ${r.error.message}`);
  const scores = UX_QUESTIONS.map((q): UxScore => {
    const a = r.value.answers[`ux_${q.key}`];
    if (a?.type !== "score")
      return {
        key: q.key,
        question: q.question,
        detail: a?.type === "abstain" ? `abstained: ${a.reason}` : "no answer",
      };
    const max = q.levels.length - 1;
    const score = Math.min(1, Math.max(0, a.score / max));
    const level = q.levels[Math.round(a.score)] ?? "";
    return {
      key: q.key,
      question: q.question,
      score,
      level,
      confidence: a.confidence,
      detail: `level ${a.score.toFixed(2)} of ${max}`,
    };
  });
  return { scores, costUsd: r.value.costUsd, inputTokens: r.value.usage.inputTokens };
}
