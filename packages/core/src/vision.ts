// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// What the loop needs from a vision model (modes D1 and D2). The engine adapts the models layer
// (`vision_grounder` role, vendor computer tools or JSON grounding) to this interface; tests mock it.
// Screenshots carry the capture id the driver issued, so every point maps back to that capture.
import type { Rect, Result } from "@ghosthand/protocol";

export interface VisionScreenshot {
  captureId: string;
  data: Uint8Array;
  width: number;
  height: number;
  mediaType: "image/png" | "image/jpeg";
}

export interface VisionError {
  kind: "unavailable" | "timeout" | "aborted" | "provider" | "invalid";
  message: string;
}

export interface VisionCall {
  model: string;
  latencyMs: number;
  costUsd: number;
}

export type GroundAnswer = VisionCall &
  ({ found: true; x: number; y: number } | { found: false; reason: string });

export interface DescribeAnswer extends VisionCall {
  text: string;
}

export interface NamedElements extends VisionCall {
  /** token → short accessible name the model read off the screenshot ("" when it cannot tell). */
  names: Record<string, string>;
}

/** One D2 action in capture pixels, or the end of the segment. */
export type DriveAction =
  | { kind: "click"; x: number; y: number; button?: "left" | "right"; count?: number }
  | { kind: "type"; text: string }
  | { kind: "key"; keys: string[] }
  | { kind: "scroll"; x: number; y: number; dx: number; dy: number }
  | { kind: "drag"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: "done"; reason: string }
  /** The provider raised a safety check: a human decides; it is never acknowledged automatically. */
  | { kind: "safety"; reason: string };

export interface DriveAnswer extends VisionCall {
  action: DriveAction;
}

export interface VisionAssist {
  readonly id: string;
  /** D1: a point on the screenshot for a target described in words. */
  ground(req: {
    screenshot: VisionScreenshot;
    instruction: string;
    signal?: AbortSignal;
  }): Promise<Result<GroundAnswer, VisionError>>;
  /** D1 screen-to-text: names for unnamed controls, given their boxes on the screenshot. */
  nameElements(req: {
    screenshot: VisionScreenshot;
    elements: Array<{ token: string; role: string; box: Rect }>;
    goal: string;
    signal?: AbortSignal;
  }): Promise<Result<NamedElements, VisionError>>;
  /** D1: what the screen shows (values drawn on a canvas, charts). */
  describe(req: {
    screenshot: VisionScreenshot;
    question: string;
    signal?: AbortSignal;
  }): Promise<Result<DescribeAnswer, VisionError>>;
  /** D2: the next single action toward the goal, from a provider computer-use tool. */
  drive?(req: {
    screenshot: VisionScreenshot;
    goal: string;
    history: readonly string[];
    signal?: AbortSignal;
  }): Promise<Result<DriveAnswer, VisionError>>;
}

/** Shown when a vision step is needed but no provider with a key is configured. */
export const NO_VISION_PROVIDER =
  "no vision provider is configured (set OPENAI_API_KEY, ANTHROPIC_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY)";

/** Surface quality thresholds (research note §1.3). */
export const QUALITY_GOOD = 0.7;
export const QUALITY_POOR = 0.4;
/** D2 segments are bounded. */
export const MAX_D2_STEPS = 8;
/** D1 failures on one screen before D2 takes over. */
export const D1_FAILURES_FOR_D2 = 2;
