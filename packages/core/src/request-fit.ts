// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Fits decision requests into the provider's context limits. Jev (direct) allows 64k tokens per request
// and 32k for the state plus the longest question; an oversized request is answered with a 400
// `max_tokens_exceeded`, so a large page (a search results page with 200 links) must be cut down before
// it is sent, not refused step after step.
import type { DecisionCapabilities, Entry, Questions } from "@ghosthand/protocol";

/**
 * Characters per Jev token for our JSON states and questions. Measured 2026-10-03 on a Bing results page:
 * 30.0k characters were counted as 14.7k input tokens (2.04). Prose is about 5.6, so this is conservative.
 */
export const JEV_CHARS_PER_TOKEN = 2;

/** Share of the provider's limits a request may use (the ratio above is an average, not a bound). */
export const REQUEST_SAFETY = 0.85;

/** After a `too_large` answer the budget for the rest of the run shrinks by this factor. */
export const SHRINK_FACTOR = 0.6;

export const jevTokens = (value: unknown): number =>
  Math.ceil((typeof value === "string" ? value : JSON.stringify(value)).length / JEV_CHARS_PER_TOKEN);

export interface RequestLimits {
  /** State plus every question. */
  total: number;
  /** State plus the longest question. */
  statePlusLongest: number;
}

export interface RequestSize extends RequestLimits {
  state: number;
}

/** The provider's limits with the safety margin, times `scale` (1, or less after a `too_large`). */
export function requestLimits(
  caps: Pick<DecisionCapabilities, "contextTokens" | "perQuestionContextTokens">,
  scale = 1,
): RequestLimits {
  const perQuestion = caps.perQuestionContextTokens ?? caps.contextTokens;
  return {
    total: Math.floor(caps.contextTokens * REQUEST_SAFETY * scale),
    statePlusLongest: Math.floor(perQuestion * REQUEST_SAFETY * scale),
  };
}

export function requestSize(state: Entry, questions: Questions): RequestSize {
  const s = jevTokens(state);
  let sum = 0;
  let longest = 0;
  for (const q of Object.values(questions)) {
    const t = jevTokens(q);
    sum += t;
    longest = Math.max(longest, t);
  }
  return { state: s, total: s + sum, statePlusLongest: s + longest };
}

export const fitsLimits = (size: RequestLimits, limits: RequestLimits): boolean =>
  size.total <= limits.total && size.statePlusLongest <= limits.statePlusLongest;

/** Candidates per head while fitting: start, minimum, and the factor per round. */
export const FIT_PER_HEAD = { start: 200, min: 12, factor: 0.6 } as const;

/** Rounds of shrinking before a request is sent as it is (the provider then decides). */
export const MAX_FIT_ROUNDS = 8;

/**
 * Builds the largest request that fits: `build(round)` makes the request for a shrink round (0 = full),
 * and the first one within `limits` is returned with its size and round. After MAX_FIT_ROUNDS the
 * smallest one is returned.
 */
export function fitRequest<T extends { state: Entry; questions: Questions }>(
  build: (round: number) => T,
  limits: RequestLimits,
): T & { size: RequestSize; round: number } {
  let round = 0;
  for (;;) {
    const request = build(round);
    const size = requestSize(request.state, request.questions);
    if (fitsLimits(size, limits) || round >= MAX_FIT_ROUNDS) return { ...request, size, round };
    round++;
  }
}
