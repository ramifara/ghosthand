// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Zod schemas for the `POST /v1/systemone` response body as it arrives on the wire. The SDK casts the
// parsed JSON to its types without checking, so we parse it ourselves.
import { z } from "zod";

export const WireNoulAnswer = z.object({ type: z.literal("noul"), noul: z.number() });
export type WireNoulAnswer = z.infer<typeof WireNoulAnswer>;

export const WireChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
});
export type WireChoiceAnswer = z.infer<typeof WireChoiceAnswer>;

export const WireScoreAnswer = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
  /** Echo of the rubric; ignored. */
  legend: z.unknown().optional(),
});
export type WireScoreAnswer = z.infer<typeof WireScoreAnswer>;

export const WireUsage = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});

/** The envelope. Answers stay `unknown` here and are checked one by one by the validator. */
export const WireResponse = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.unknown()),
  usage: WireUsage,
});
export type WireResponse = z.infer<typeof WireResponse>;
