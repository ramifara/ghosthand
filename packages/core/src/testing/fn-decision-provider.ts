// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A DecisionProvider whose answers come from a test function over the asked questions.
import type {
  Answer,
  DecisionAskOptions,
  DecisionCapabilities,
  DecisionImageData,
  DecisionProvider,
  DecisionResponse,
  Entry,
  Questions,
} from "@ghosthand/protocol";
import { ok } from "@ghosthand/protocol";

export type AnswerFn = (questions: Questions, state: Entry, call: number) => Record<string, Answer>;

/** A confident choice of `key` among the question's criteria. */
export function choiceOf(questions: Questions, head: string, key: string, p = 0.95): Answer {
  const q = questions[head];
  const keys = q?.type === "choice" ? Object.keys(q.criteria) : [key];
  const rest = keys.length > 1 ? (1 - p) / (keys.length - 1) : 0;
  return {
    type: "choice",
    choice: key,
    confidence: p,
    probabilities: Object.fromEntries(keys.map((k) => [k, k === key ? (keys.length > 1 ? p : 1) : rest])),
  };
}

export const noulOf = (p: number): Answer => ({ type: "noul", p });

export class FnDecisionProvider implements DecisionProvider {
  readonly id = "fn";
  readonly capabilities: DecisionCapabilities = {
    maxOptions: 255,
    maxLevels: 10,
    contextTokens: 64_000,
    zdr: true,
    images: true,
    box: true,
  };
  readonly requests: Array<{ state: Entry; questions: Questions; images: DecisionImageData[] }> = [];
  readonly #fn: AnswerFn;

  constructor(fn: AnswerFn) {
    this.#fn = fn;
  }

  async ask(state: Entry, questions: Questions, opts: DecisionAskOptions = {}) {
    this.requests.push({ state, questions, images: opts.images ?? [] });
    const given = this.#fn(questions, state, this.requests.length);
    const answers: Record<string, Answer> = {};
    for (const name of Object.keys(questions))
      answers[name] = given[name] ?? { type: "abstain", reason: "not answered by the test" };
    const r: DecisionResponse = {
      answers,
      model: "fn",
      provider: this.id,
      usage: { inputTokens: 100, outputTokens: 0 },
      costUsd: 0.0000042,
      latencyMs: 1,
      calibration: "native",
    };
    return ok(r);
  }
}
