// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Checks a request against provider caps before anything is sent. The SDK only rejects empty question
// sets and short score lists; option and level caps, null score levels and context size are ours.

import { estimateImageTokens, readImageSize, sniffImageType } from "@ghosthand/core";
import type {
  DecisionCapabilities,
  DecisionError,
  DecisionImageData,
  Entry,
  Question,
  Questions,
  Result,
} from "@ghosthand/protocol";
import { err, ImageRef, ok } from "@ghosthand/protocol";
import { countRefUses, TYPESAFE_IMAGE_LIMITS } from "./images.ts";

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
  /** State text plus the images it refers to. */
  state: number;
  /** Per question name, images it refers to included. */
  questions: Record<string, number>;
  /** State plus every question. Checked against `contextTokens`. */
  total: number;
  /** State plus the longest question. Checked against `perQuestionContextTokens`. */
  stateWithLongestQuestion: number;
  /** Image tokens across every use (each reference sends the image again). */
  imageTokens: number;
}

/** Image tokens the text of `value` pulls in: one image cost per occurrence of each ref. */
function imageTokensIn(value: Entry | Question, images: readonly DecisionImageData[]): number {
  if (images.length === 0) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let sum = 0;
  for (const img of images) sum += countRefUses(text, img.ref) * estimateImageTokens(img.width, img.height);
  return sum;
}

export function estimateRequestTokens(
  state: Entry,
  questions: Questions,
  images: readonly DecisionImageData[] = [],
): TokenEstimate {
  let imageTokens = imageTokensIn(state, images);
  const stateTokens = estimateTokens(state) + imageTokens;
  const perQuestion: Record<string, number> = {};
  let sum = 0;
  let longest = 0;
  for (const [name, q] of Object.entries(questions)) {
    const inQuestion = imageTokensIn(q, images);
    imageTokens += inQuestion;
    const t = estimateTokens(q) + inQuestion;
    perQuestion[name] = t;
    sum += t;
    longest = Math.max(longest, t);
  }
  return {
    state: stateTokens,
    questions: perQuestion,
    total: stateTokens + sum,
    stateWithLongestQuestion: stateTokens + longest,
    imageTokens,
  };
}

export type PreflightCaps = Pick<
  DecisionCapabilities,
  "maxOptions" | "maxLevels" | "contextTokens" | "perQuestionContextTokens" | "images" | "box" | "imageLimits"
>;

const mib = (n: number): string => `${(n / (1024 * 1024)).toFixed(0)} MiB`;

/** Checks one image against the provider's limits and its own header. */
function checkImage(img: DecisionImageData, caps: PreflightCaps): string | undefined {
  const limits = caps.imageLimits ?? TYPESAFE_IMAGE_LIMITS;
  if (!ImageRef.safeParse(img.ref).success) return `image ref "${img.ref}" must look like <image:name>`;
  const sniffed = sniffImageType(img.data);
  if (sniffed === undefined) return `image ${img.ref} is not PNG or JPEG`;
  if (sniffed !== img.mimeType)
    return `image ${img.ref} is declared ${img.mimeType} but its bytes are ${sniffed}`;
  const header = readImageSize(img.data);
  if (header && (header.width !== img.width || header.height !== img.height)) {
    return `image ${img.ref} is declared ${img.width}×${img.height} but its header says ${header.width}×${header.height}`;
  }
  const { width, height } = img;
  if (width < limits.minSide || height < limits.minSide) {
    return `image ${img.ref} is ${width}×${height}; each side must be at least ${limits.minSide} px`;
  }
  if (width > limits.maxSide || height > limits.maxSide) {
    return `image ${img.ref} is ${width}×${height}; each side must be at most ${limits.maxSide} px`;
  }
  const pixels = width * height;
  if (pixels < limits.minPixels || pixels > limits.maxPixels) {
    return `image ${img.ref} has ${pixels} pixels; the API accepts ${limits.minPixels} to ${limits.maxPixels} pixels`;
  }
  if (img.data.byteLength > limits.maxBytes) {
    return `image ${img.ref} is ${mib(img.data.byteLength)}; the cap is ${mib(limits.maxBytes)} (bytes)`;
  }
  return undefined;
}

const invalid = (provider: string, message: string): Result<TokenEstimate, DecisionError> =>
  err({ kind: "invalid", provider, message });

/** Validates question shapes against `caps` and estimates the context. Returns the estimate on success. */
export function preflight(
  state: Entry,
  questions: Questions,
  caps: PreflightCaps,
  provider = "typesafe",
  images: readonly DecisionImageData[] = [],
): Result<TokenEstimate, DecisionError> {
  const entries = Object.entries(questions);
  if (entries.length === 0) return invalid(provider, "at least one question is required");

  const boxes = entries.filter(([, q]) => q.type === "box").map(([name]) => name);
  if (boxes.length > 0 && caps.box !== true) {
    return invalid(provider, `${provider} does not answer box questions ("${boxes[0]}")`);
  }
  if (images.length > 0 && caps.images !== true) {
    return invalid(provider, `${provider} does not accept images`);
  }
  if (boxes.length > 0 && images.length === 0) {
    return invalid(provider, `box "${boxes[0]}" needs an image in the request`);
  }
  if (images.length > 0) {
    const refs = new Set<string>();
    const requestText = JSON.stringify({ state, questions });
    for (const img of images) {
      if (refs.has(img.ref)) return invalid(provider, `duplicate image ref ${img.ref}`);
      refs.add(img.ref);
      const bad = checkImage(img, caps);
      if (bad) return invalid(provider, bad);
      if (countRefUses(requestText, img.ref) === 0) {
        return invalid(provider, `nothing in the state or questions refers to image ${img.ref}`);
      }
    }
  }

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

  const estimate = estimateRequestTokens(state, questions, images);
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
