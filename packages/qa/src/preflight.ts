// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Preflight (cooper667/jev-playwright `preflight`): one decision request per case, before anything runs.
// Per step: can a browser test do or check it (`flag`), and how many elements does it name (`count`).
// Both are questions about the words, so the state is the numbered checklist and no page is in view.
import { ANTI_INJECTION } from "@ghosthand/core";
import type { ChoiceQuestion, DecisionProvider, Questions } from "@ghosthand/protocol";
import type { QaCase, StepFlag } from "./spec-schema.ts";

export const STEP_FLAGS: Record<StepFlag, string> = {
  ok: "Can be carried out by clicking something on the page, typing text that is quoted in the step, or opening a URL or path spelled out in full in the step or shown on the page; and its expectations can be checked from the page's accessibility tree once it has finished loading: which elements exist, their roles, labels, text, values and states",
  transient:
    "Asserts a state that has passed by the time the page settles: a brief spinner, a flash, a loading skeleton, an animation, an in-between step",
  derived:
    "Needs a value the step describes but does not state in full and the page does not show whole: a URL built by replacing part of the current one, a computed date, text to type that is copied from elsewhere",
  visual:
    "Is about how something looks or where it sits, which the accessibility tree does not record: colour, size, position, alignment, spacing, overlap, clipped or overflowing text, an icon's appearance",
  external:
    "Happens outside the page: another tab or app, an email, a terminal, the system clock, a network condition",
};

const COUNTS: Record<string, string> = {
  "1": "One: the step names a single element to click, type into or open",
  "2": "Two, such as a field to fill and then a button to press",
  "3": "Three",
  "4": "Four or more",
};

export interface StepPreflight {
  flag: StepFlag;
  /** Elements the step names (1–4); bounds the subgoal's steps. */
  actions: number;
  /** Probability of the chosen flag; undefined when the provider abstained. */
  confidence?: number;
  /** False when the answer was missing or invalid and defaults were used. */
  answered: boolean;
}

export interface CasePreflight {
  steps: StepPreflight[];
  costUsd: number;
  latencyMs: number;
  inputTokens: number;
  model?: string;
  error?: string;
}

export const checklistLine = (perform: string, expects: string[]): string =>
  expects.length > 0 ? `${perform} Expect: ${expects.join("; ")}.` : perform;

export function preflightQuestions(c: QaCase): Questions {
  const questions: Questions = {};
  for (const s of c.steps) {
    const flag: ChoiceQuestion = {
      type: "choice",
      instructions: `Can a browser test carry out step ${s.index} and check its expectations from the page once it has finished loading? ${ANTI_INJECTION}`,
      criteria: STEP_FLAGS,
    };
    const count: ChoiceQuestion = {
      type: "choice",
      instructions: `How many separate elements does step ${s.index} say to interact with: every field it gives a value for, plus every control it says to click? Count only what its own words name. ${ANTI_INJECTION}`,
      criteria: COUNTS,
    };
    questions[`flag${s.index}`] = flag;
    questions[`count${s.index}`] = count;
  }
  return questions;
}

const isFlag = (v: string): v is StepFlag => v in STEP_FLAGS;

/** Asks once per case; on any failure every step falls back to `ok` with a quoted-value count. */
export async function preflightCase(
  c: QaCase,
  decision: DecisionProvider | undefined,
  opts: { signal?: AbortSignal } = {},
): Promise<CasePreflight> {
  const fallback = (error?: string): CasePreflight => ({
    steps: c.steps.map((s) => ({ flag: "ok", actions: quotedCount(s.perform), answered: false })),
    costUsd: 0,
    latencyMs: 0,
    inputTokens: 0,
    ...(error ? { error } : {}),
  });
  if (!decision) return fallback("no decision provider");
  const state = {
    case: c.title,
    checklist: c.steps.map(
      (s) =>
        `${s.index}. ${checklistLine(
          s.perform,
          s.expects.map((e) => e.text),
        )}`,
    ),
  };
  const r = await decision.ask(state, preflightQuestions(c), opts.signal ? { signal: opts.signal } : {});
  if (!r.ok) return fallback(`${r.error.kind}: ${r.error.message}`);
  const steps = c.steps.map((s): StepPreflight => {
    const flag = r.value.answers[`flag${s.index}`];
    const count = r.value.answers[`count${s.index}`];
    const chosen = flag?.type === "choice" && isFlag(flag.choice) ? flag.choice : undefined;
    const n = count?.type === "choice" ? Number(count.choice) : Number.NaN;
    return {
      flag: chosen ?? "ok",
      actions: Number.isFinite(n) && n >= 1 ? Math.max(n, quotedCount(s.perform)) : quotedCount(s.perform),
      ...(flag?.type === "choice" ? { confidence: flag.confidence } : {}),
      answered: chosen !== undefined,
    };
  });
  return {
    steps,
    costUsd: r.value.costUsd,
    latencyMs: r.value.latencyMs,
    inputTokens: r.value.usage.inputTokens,
    model: r.value.model,
  };
}

/** Each quoted value needs a field of its own, plus one control to commit. */
export function quotedCount(text: string): number {
  const quoted = text.match(/["“][^"”]+["”]/g)?.length ?? 0;
  return Math.max(1, Math.min(4, quoted + (quoted > 0 ? 1 : 0)));
}

/** Decisive steps decide the verdict; the rest are reported as advisory. */
export const isDecisiveFlag = (f: StepFlag): boolean => f === "ok" || f === "visual";
