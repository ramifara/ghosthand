// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The vision reviewer as the QA judge sees it. The engine implements it over the models layer
// (role `vision_reviewer`); tests use fakes. A vision verdict only counts when code and Jev could not decide.
import type { Result, VerifyState } from "@ghosthand/protocol";

export interface VisionVerdict {
  state: VerifyState;
  confidence: number;
  detail: string;
}

export interface VisionImage {
  data: Uint8Array;
  mediaType: "image/png" | "image/jpeg";
}

export interface VisionCallMeta {
  model: string;
  costUsd: number;
  latencyMs: number;
}

export type VisionError = { kind: "unavailable" | "failed"; message: string };

export interface VisionJudge {
  readonly id: string;
  /** One verdict per criterion, in order. */
  check(input: {
    criteria: string[];
    image: VisionImage;
    context: string;
    signal?: AbortSignal;
  }): Promise<Result<VisionCallMeta & { verdicts: VisionVerdict[] }, VisionError>>;
  /** Visual polish of a screen, 0 (broken) to 1 (clean), with issues found. Reported, never decisive. */
  rate(input: {
    image: VisionImage;
    context: string;
    signal?: AbortSignal;
  }): Promise<Result<VisionCallMeta & { score: number; issues: string[] }, VisionError>>;
}
