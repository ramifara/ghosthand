// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Turns a driver capture into the image a decision request carries (ADR 0020), and maps a box answer
// back to a click target in capture pixels. Pure: drivers prepare pixels, this checks and labels them.
import type {
  Box,
  Capture,
  DecisionImageData,
  ImageLimits,
  ImageRef,
  Result,
  ScreenshotOptions,
} from "@ghosthand/protocol";
import { type CaptureTarget, err, ok } from "@ghosthand/protocol";
import { readImageSize, sniffImageType } from "./image-header.ts";

/** The ref the step screenshot is placed under in the state (`state.screen`). */
export const SCREEN_REF: ImageRef = "<image:screen>";

/** TypeSafe's documented image limits (docs/research/notes/jev-1-14-images-box.md). */
export const JEV_IMAGE_LIMITS: ImageLimits = {
  minSide: 280,
  maxSide: 1568,
  minPixels: 78_400,
  maxPixels: 2_458_624,
  maxBytes: 16 * 1024 * 1024,
};

/** What the loop asks a driver for when the screenshot goes to Jev: JPEG q80 costs the tokens of a PNG. */
export const DECISION_SCREENSHOT_OPTIONS: Required<ScreenshotOptions> = {
  format: "jpeg",
  quality: 80,
  maxSide: JEV_IMAGE_LIMITS.maxSide,
  mask: "secrets",
};

export type PrepareImageError = { kind: "too_small" | "too_large" | "unsupported"; message: string };

/**
 * Checks a capture against the limits and labels it for a request. The bytes decide the type and size;
 * a capture whose header disagrees with its bytes is refused.
 */
export function prepareForDecision(
  shot: { capture: Capture; data: Uint8Array },
  opts: { ref?: ImageRef; limits?: ImageLimits } = {},
): Result<DecisionImageData, PrepareImageError> {
  const { capture, data } = shot;
  const limits = opts.limits ?? JEV_IMAGE_LIMITS;
  const type = sniffImageType(data);
  if (type === undefined) return err({ kind: "unsupported", message: "capture bytes are not PNG or JPEG" });
  if (type !== capture.mimeType) {
    return err({
      kind: "unsupported",
      message: `capture says ${capture.mimeType} but its bytes are ${type}`,
    });
  }
  const size = readImageSize(data);
  if (!size) return err({ kind: "unsupported", message: "capture header is unreadable" });
  if (size.width !== capture.width || size.height !== capture.height) {
    return err({
      kind: "unsupported",
      message: `capture says ${capture.width}×${capture.height} but its header says ${size.width}×${size.height}`,
    });
  }
  const { width, height } = size;
  const pixels = width * height;
  if (width < limits.minSide || height < limits.minSide || pixels < limits.minPixels) {
    return err({ kind: "too_small", message: `${width}×${height} is below ${limits.minSide} px per side` });
  }
  if (width > limits.maxSide || height > limits.maxSide || pixels > limits.maxPixels) {
    return err({ kind: "too_large", message: `${width}×${height} is above ${limits.maxSide} px per side` });
  }
  if (data.byteLength > limits.maxBytes) {
    return err({
      kind: "too_large",
      message: `${data.byteLength} bytes is above the ${limits.maxBytes} byte cap`,
    });
  }
  return ok({ ref: opts.ref ?? SCREEN_REF, mimeType: type, width, height, captureId: capture.id, data });
}

/** The centre of a box answer as a click target in the capture's pixels (the driver maps those to points). */
export function boxCentre(box: Box, capture: Pick<Capture, "id" | "width" | "height">): CaptureTarget {
  return {
    captureId: capture.id,
    x: Math.round(((box.left + box.right) / 2) * capture.width),
    y: Math.round(((box.top + box.bottom) / 2) * capture.height),
  };
}

/** Fraction of the image a box covers. */
export function boxArea(box: Box): number {
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
}
