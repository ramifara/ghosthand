// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Vendor-neutral decision questions and answers. The shapes match TypeSafe's typed primitives
// (noul, choice, score, and since Jev 1.14 box), which every Jev carrier accepts. Images travel
// beside the JSON state as `DecisionImage`s (ADR 0020); the state refers to one by its `ref`.
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

/** Locates what `instructions` describe in an image referenced from the state (Jev 1.14, ADR 0020). */
export const BoxQuestion = z.object({
  type: z.literal("box"),
  instructions: Entry.optional(),
});
export type BoxQuestion = z.infer<typeof BoxQuestion>;

export const Question = z.discriminatedUnion("type", [
  NoulQuestion,
  ChoiceQuestion,
  ScoreQuestion,
  BoxQuestion,
]);
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

/** Edges as fractions of the image: `top`/`bottom` of its height from the top, `left`/`right` of its width. */
export const Box = z.object({
  top: z.number(),
  bottom: z.number(),
  left: z.number(),
  right: z.number(),
});
export type Box = z.infer<typeof Box>;

/** A box is well-formed when its edges are ordered and inside the unit square. */
export function isValidBox(b: Box): boolean {
  const unit = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1;
  return (
    unit(b.top) && unit(b.bottom) && unit(b.left) && unit(b.right) && b.top < b.bottom && b.left < b.right
  );
}

export const BoxAnswer = z.object({
  type: z.literal("box"),
  box: Box,
  /** Null when the API reports none. Recorded, never gated on (ADR 0020). */
  confidence: Probability.nullable(),
});
export type BoxAnswer = z.infer<typeof BoxAnswer>;

/** Produced by our validators when a provider answer fails a fail-closed check. */
export const AbstainAnswer = z.object({ type: z.literal("abstain"), reason: z.string() });
export type AbstainAnswer = z.infer<typeof AbstainAnswer>;

export const Answer = z.discriminatedUnion("type", [
  NoulAnswer,
  ChoiceAnswer,
  ScoreAnswer,
  BoxAnswer,
  AbstainAnswer,
]);

/** Reference written into the state wherever an image goes, e.g. `<image:screen>`. */
export const ImageRef = z.string().regex(/^<image:[a-z0-9_-]+>$/, "an image ref like <image:screen>");
export type ImageRef = z.infer<typeof ImageRef>;

export const ImageMimeType = z.enum(["image/png", "image/jpeg"]);
export type ImageMimeType = z.infer<typeof ImageMimeType>;

/** Metadata of an image sent with a decision request; the bytes never cross a process boundary. */
export const DecisionImage = z.object({
  ref: ImageRef,
  mimeType: ImageMimeType,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** The capture the image was prepared from, when there is one. */
  captureId: z.string().optional(),
});
export type DecisionImage = z.infer<typeof DecisionImage>;

/** An image with its bytes, as handed to a provider in memory. */
export type DecisionImageData = DecisionImage & {
  data: Uint8Array;
  /** File name in the run folder, once written (recorded on the decision.request event). */
  file?: string;
};

/** Image limits a provider enforces (TypeSafe direct: docs/research/notes/jev-1-14-images-box.md). */
export const ImageLimits = z.object({
  minSide: z.number().int().positive(),
  maxSide: z.number().int().positive(),
  minPixels: z.number().int().positive(),
  maxPixels: z.number().int().positive(),
  maxBytes: z.number().int().positive(),
});
export type ImageLimits = z.infer<typeof ImageLimits>;
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
  /** Accepts images in requests. Absent means no. */
  images: z.boolean().optional(),
  /** Answers box questions. Absent means no. */
  box: z.boolean().optional(),
  imageLimits: ImageLimits.optional(),
});
export type DecisionCapabilities = z.infer<typeof DecisionCapabilities>;

export const DecisionErrorKind = z.enum([
  "auth",
  "rate_limit",
  "overloaded",
  "invalid",
  "too_large",
  /** The API rejected an image or asset (a preflight gap: size, format, header, model). */
  "image_rejected",
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
