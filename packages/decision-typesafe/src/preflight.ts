// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Checks a request against provider caps before anything is sent. The SDK only rejects empty question
// sets and short score lists; option and level caps, null score levels and context size are ours.
import type {
  DecisionCapabilities,
  DecisionError,
  Entry,
  Question,
  Questions,
  Result,
} from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";

/**
 * Conservative characters-per-token ratio; no tokenizer or count endpoint is published. JSON states and
 * questions measured 2.04 (a Bing results page, 2026-10-03: 30.0k characters, 14.7k input tokens); with 3
 * an oversized page passed the preflight and was rejected by the server.
 */
export const CHARS_PER_TOKEN = 2;

/** Estimated tokens for a state, question or any JSON value (serialized length / 2, rounded up). */
export function estimateTokens(value: Entry | Question): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface TokenEstimate {
  state: number;
  /** Per question name. */
  questions: Record<string, number>;
  /** State plus every question. Checked against `contextTokens`. */
  total: number;
  /** State plus the longest question. Checked against `perQuestionContextTokens`. */
  stateWithLongestQuestion: number;
}

export function estimateRequestTokens(state: Entry, questions: Questions): TokenEstimate {
  const stateTokens = estimateTokens(state);
  const perQuestion: Record<string, number> = {};
  let sum = 0;
  let longest = 0;
  for (const [name, q] of Object.entries(questions)) {
    const t = estimateTokens(q);
    perQuestion[name] = t;
    sum += t;
    longest = Math.max(longest, t);
  }
  return {
    state: stateTokens,
    questions: perQuestion,
    total: stateTokens + sum,
    stateWithLongestQuestion: stateTokens + longest,
  };
}

export type PreflightCaps = Pick<
  DecisionCapabilities,
  "maxOptions" | "maxLevels" | "contextTokens" | "perQuestionContextTokens"
>;

const invalid = (provider: string, message: string): Result<TokenEstimate, DecisionError> =>
  err({ kind: "invalid", provider, message });

/** Validates question shapes against `caps` and estimates the context. Returns the estimate on success. */
export function preflight(
  state: Entry,
  questions: Questions,
  caps: PreflightCaps,
  provider = "typesafe",
): Result<TokenEstimate, DecisionError> {
  const entries = Object.entries(questions);
  if (entries.length === 0) return invalid(provider, "at least one question is required");

  for (const [name, q] of entries) {
    if (name.length === 0) return invalid(provider, "question names must be non-empty");
    if (q.type === "noul") {
      const described = q.criteria?.true != null || q.criteria?.false != null;
      if (q.instructions == null && !described) {
        return invalid(provider, `noul "${name}" needs instructions or a described outcome`);
      }
    } else if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      if (keys.length < 2) return invalid(provider, `choice "${name}" needs at least 2 options`);
      if (keys.length > caps.maxOptions) {
        return invalid(
          provider,
          `choice "${name}" has ${keys.length} options; the cap is ${caps.maxOptions}`,
        );
      }
      if (keys.some((k) => k.length === 0))
        return invalid(provider, `choice "${name}" has an empty option key`);
    } else if (q.type === "score") {
      const n = q.criteria.length;
      if (n < 2) return invalid(provider, `score "${name}" needs at least 2 levels`);
      if (n > caps.maxLevels) {
        return invalid(provider, `score "${name}" has ${n} levels; the cap is ${caps.maxLevels}`);
      }
      // The schema type already excludes null, but callers can build questions without parsing them.
      const nullAt = (q.criteria as readonly unknown[]).indexOf(null);
      if (nullAt !== -1) return invalid(provider, `score "${name}" level ${nullAt} is null`);
    }
  }

  const estimate = estimateRequestTokens(state, questions);
  if (estimate.total > caps.contextTokens) {
    return err({
      kind: "too_large",
      provider,
      message: `estimated ${estimate.total} tokens (state + all questions) exceeds ${caps.contextTokens}`,
    });
  }
  const perQuestion = caps.perQuestionContextTokens;
  if (perQuestion !== undefined && estimate.stateWithLongestQuestion > perQuestion) {
    return err({
      kind: "too_large",
      provider,
      message: `estimated ${estimate.stateWithLongestQuestion} tokens (state + longest question) exceeds ${perQuestion}`,
    });
  }
  return ok(estimate);
}
