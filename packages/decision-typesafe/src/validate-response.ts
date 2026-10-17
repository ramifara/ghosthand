// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Fail-closed checks on provider answers (ADR 0004, plan §3.2). Pure: no I/O, no SDK imports.
// Any answer that fails a check becomes `{type: 'abstain', reason}` so the loop can never act on it.
import type { AbstainAnswer, Answer, ChoiceQuestion, Questions, ScoreQuestion } from "@ghosthand/protocol";
import { isValidBox } from "@ghosthand/protocol";
import { WireBoxAnswer, WireChoiceAnswer, WireNoulAnswer, WireScoreAnswer } from "./wire.ts";

/** Probabilities must sum to 1 within this tolerance. */
export const PROBABILITY_SUM_TOLERANCE = 0.025;
/**
 * A score must lie within this distance of the distribution mean Σ i·p_i. Measured 2026-10-01: the API rounds
 * probabilities, so a 10-level score of 6.86 came with a recomputed mean of 6.76. The tolerance grows with the
 * number of levels (0.015 per level step, never below the plan's 0.02).
 */
export const SCORE_MEAN_TOLERANCE = 0.02;
export const scoreMeanTolerance = (levels: number): number =>
  Math.max(SCORE_MEAN_TOLERANCE, (levels - 1) * 0.015);
/** Slack for float comparisons in the argmax check. */
const ARGMAX_EPSILON = 1e-9;

const abstain = (reason: string): AbstainAnswer => ({ type: "abstain", reason });

const isProbability = (x: number): boolean => Number.isFinite(x) && x >= 0 && x <= 1;

function sameKeys(actual: string[], expected: string[]): { missing: string[]; unexpected: string[] } {
  const a = new Set(actual);
  const e = new Set(expected);
  return {
    missing: expected.filter((k) => !a.has(k)),
    unexpected: actual.filter((k) => !e.has(k)),
  };
}

const list = (keys: string[], max = 5): string =>
  keys.length <= max ? keys.join(", ") : `${keys.slice(0, max).join(", ")} … (+${keys.length - max})`;

/** Checks a probability map against the expected keys. Returns a failure reason or undefined. */
function checkDistribution(
  probabilities: Record<string, number>,
  expectedKeys: string[],
): string | undefined {
  const { missing, unexpected } = sameKeys(Object.keys(probabilities), expectedKeys);
  if (missing.length > 0 || unexpected.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing ${list(missing)}`);
    if (unexpected.length > 0) parts.push(`unexpected ${list(unexpected)}`);
    return `probability keys do not match options (${parts.join("; ")})`;
  }
  let sum = 0;
  for (const [k, p] of Object.entries(probabilities)) {
    if (!isProbability(p)) return `probability for "${k}" is outside [0, 1]: ${p}`;
    sum += p;
  }
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
    return `probabilities sum to ${sum.toFixed(4)}, not 1 ± ${PROBABILITY_SUM_TOLERANCE}`;
  }
  return undefined;
}

export function validateNoulAnswer(raw: unknown): Answer {
  const parsed = WireNoulAnswer.safeParse(raw);
  if (!parsed.success) return abstain("malformed noul answer");
  const p = parsed.data.noul;
  if (!isProbability(p)) return abstain(`noul probability outside [0, 1]: ${p}`);
  return { type: "noul", p };
}

export function validateChoiceAnswer(question: ChoiceQuestion, raw: unknown): Answer {
  const parsed = WireChoiceAnswer.safeParse(raw);
  if (!parsed.success) return abstain("malformed choice answer");
  const { choice, confidence, probabilities } = parsed.data;
  const options = Object.keys(question.criteria);
  const bad = checkDistribution(probabilities, options);
  if (bad) return abstain(bad);
  if (!isProbability(confidence)) return abstain(`confidence outside [0, 1]: ${confidence}`);
  const chosen = probabilities[choice];
  if (chosen === undefined) return abstain(`choice "${choice}" is not an option`);
  const max = Math.max(...Object.values(probabilities));
  if (chosen < max - ARGMAX_EPSILON) {
    return abstain(`choice "${choice}" (p=${chosen}) is not the argmax (p=${max})`);
  }
  return { type: "choice", choice, confidence, probabilities: { ...probabilities } };
}

export function validateScoreAnswer(question: ScoreQuestion, raw: unknown): Answer {
  const parsed = WireScoreAnswer.safeParse(raw);
  if (!parsed.success) return abstain("malformed score answer");
  const { score, confidence, probabilities } = parsed.data;
  const levels = question.criteria.map((_, i) => String(i));
  const bad = checkDistribution(probabilities, levels);
  if (bad) return abstain(bad);
  if (!isProbability(confidence)) return abstain(`confidence outside [0, 1]: ${confidence}`);
  const mean = levels.reduce((acc, k, i) => acc + i * (probabilities[k] ?? 0), 0);
  const tolerance = scoreMeanTolerance(levels.length);
  if (Math.abs(score - mean) > tolerance) {
    return abstain(`score ${score} is not within ${tolerance} of the distribution mean ${mean.toFixed(4)}`);
  }
  return { type: "score", score, confidence, probabilities: { ...probabilities } };
}

/** A box must have ordered edges inside the unit square; confidence may be null (ADR 0020). */
export function validateBoxAnswer(raw: unknown): Answer {
  const parsed = WireBoxAnswer.safeParse(raw);
  if (!parsed.success) return abstain("malformed box answer");
  const { box, confidence } = parsed.data;
  if (!isValidBox(box)) {
    return abstain(
      `box edges are not ordered inside [0, 1]: t=${box.top} b=${box.bottom} l=${box.left} r=${box.right}`,
    );
  }
  if (confidence !== null && !isProbability(confidence))
    return abstain(`confidence outside [0, 1]: ${confidence}`);
  return { type: "box", box: { ...box }, confidence };
}

/**
 * Validates raw wire answers against the questions that were asked. The result has exactly the
 * question keys. If the answer keys differ from the question keys at all, every answer abstains,
 * because a mismatched response cannot be trusted piecemeal.
 */
export function validateAnswers(
  questions: Questions,
  rawAnswers: Record<string, unknown>,
): Record<string, Answer> {
  const names = Object.keys(questions);
  const out: Record<string, Answer> = {};
  const { missing, unexpected } = sameKeys(Object.keys(rawAnswers), names);
  if (missing.length > 0 || unexpected.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing ${list(missing)}`);
    if (unexpected.length > 0) parts.push(`unexpected ${list(unexpected)}`);
    const reason = `answer keys do not match question keys (${parts.join("; ")})`;
    for (const name of names) out[name] = abstain(reason);
    return out;
  }
  for (const [name, question] of Object.entries(questions)) {
    const raw = rawAnswers[name];
    const rawType = typeof raw === "object" && raw !== null && "type" in raw ? raw.type : undefined;
    if (rawType !== question.type) {
      out[name] = abstain(`expected a ${question.type} answer, got ${String(rawType)}`);
      continue;
    }
    switch (question.type) {
      case "noul":
        out[name] = validateNoulAnswer(raw);
        break;
      case "choice":
        out[name] = validateChoiceAnswer(question, raw);
        break;
      case "score":
        out[name] = validateScoreAnswer(question, raw);
        break;
      case "box":
        out[name] = validateBoxAnswer(raw);
        break;
    }
  }
  return out;
}

/** Names of answers that abstained, for logging. */
export function abstainedNames(answers: Record<string, Answer>): string[] {
  return Object.entries(answers)
    .filter(([, a]) => a.type === "abstain")
    .map(([name]) => name);
}
