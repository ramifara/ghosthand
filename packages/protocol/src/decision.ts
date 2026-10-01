// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Vendor-neutral decision questions and answers. The shapes match TypeSafe's typed primitives
// (noul, choice, score), which every Jev carrier accepts.
import { z } from "zod";
import { Entry } from "./json.ts";

export const MAX_CHOICE_OPTIONS = 255;
export const MAX_SCORE_LEVELS = 10;

export const NoulQuestion = z.object({
  type: z.literal("noul"),
  instructions: Entry.optional(),
  criteria: z.object({ true: Entry.optional(), false: Entry.optional() }).optional(),
});
export type NoulQuestion = z.infer<typeof NoulQuestion>;

export const ChoiceQuestion = z.object({
  type: z.literal("choice"),
  instructions: Entry.optional(),
  criteria: z
    .record(z.string().min(1), Entry)
    .refine((c) => Object.keys(c).length >= 2, "a choice needs at least 2 options")
    .refine(
      (c) => Object.keys(c).length <= MAX_CHOICE_OPTIONS,
      `a choice allows at most ${MAX_CHOICE_OPTIONS} options`,
    ),
});
export type ChoiceQuestion = z.infer<typeof ChoiceQuestion>;

export const ScoreQuestion = z.object({
  type: z.literal("score"),
  instructions: Entry.optional(),
  criteria: z
    .array(Entry.refine((e) => e !== null, "score levels must not be null"))
    .min(2)
    .max(MAX_SCORE_LEVELS),
});
export type ScoreQuestion = z.infer<typeof ScoreQuestion>;

export const Question = z.discriminatedUnion("type", [NoulQuestion, ChoiceQuestion, ScoreQuestion]);
export type Question = z.infer<typeof Question>;

export const Questions = z
  .record(z.string().min(1), Question)
  .refine((q) => Object.keys(q).length > 0, "at least one question");
export type Questions = z.infer<typeof Questions>;

const Probability = z.number().min(0).max(1);

export const NoulAnswer = z.object({ type: z.literal("noul"), p: Probability });
export type NoulAnswer = z.infer<typeof NoulAnswer>;

export const ChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: Probability,
  probabilities: z.record(z.string(), Probability),
});
export type ChoiceAnswer = z.infer<typeof ChoiceAnswer>;

export const ScoreAnswer = z.object({
  type: z.literal("score"),
  /** Expected score; may fall between levels. */
  score: z.number(),
  confidence: Probability,
  probabilities: z.record(z.string(), Probability),
});
export type ScoreAnswer = z.infer<typeof ScoreAnswer>;

/** Produced by our validators when a provider answer fails a fail-closed check. */
export const AbstainAnswer = z.object({ type: z.literal("abstain"), reason: z.string() });
export type AbstainAnswer = z.infer<typeof AbstainAnswer>;

export const Answer = z.discriminatedUnion("type", [NoulAnswer, ChoiceAnswer, ScoreAnswer, AbstainAnswer]);
export type Answer = z.infer<typeof Answer>;

export const DecisionRequest = z.object({
  state: Entry,
  questions: Questions,
});
export type DecisionRequest = z.infer<typeof DecisionRequest>;

export const DecisionUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export type DecisionUsage = z.infer<typeof DecisionUsage>;

export const Calibration = z.enum(["native", "logprob", "verbalized"]);
export type Calibration = z.infer<typeof Calibration>;

export const DecisionResponse = z.object({
  answers: z.record(z.string(), Answer),
  model: z.string(),
  provider: z.string(),
  requestId: z.string().optional(),
  usage: DecisionUsage,
  costUsd: z.number().nonnegative(),
  latencyMs: z.number().nonnegative(),
  calibration: Calibration,
});
export type DecisionResponse = z.infer<typeof DecisionResponse>;

export const DecisionCapabilities = z.object({
  maxOptions: z.number().int().positive(),
  maxLevels: z.number().int().positive(),
  contextTokens: z.number().int().positive(),
  /** Tokens allowed for state plus the single longest question. */
  perQuestionContextTokens: z.number().int().positive().optional(),
  zdr: z.boolean(),
});
export type DecisionCapabilities = z.infer<typeof DecisionCapabilities>;

export const DecisionErrorKind = z.enum([
  "auth",
  "rate_limit",
  "overloaded",
  "invalid",
  "too_large",
  "timeout",
  "network",
  "aborted",
  "server",
  "budget",
  "unknown",
]);
export type DecisionErrorKind = z.infer<typeof DecisionErrorKind>;

export const DecisionError = z.object({
  kind: DecisionErrorKind,
  message: z.string(),
  provider: z.string(),
  status: z.number().int().optional(),
  requestId: z.string().optional(),
  retryAfterMs: z.number().nonnegative().optional(),
});
export type DecisionError = z.infer<typeof DecisionError>;
