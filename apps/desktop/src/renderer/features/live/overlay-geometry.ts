// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Places an element box (top-viewport CSS pixels) on the screencast image as percentages, so the overlay
// scales with the image without measuring it.
import type { Rect } from "@ghosthand/protocol";

export interface PercentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (v: number): number => Math.min(100, Math.max(0, v));

export function projectRect(
  bounds: Rect,
  viewport: { deviceWidth: number; deviceHeight: number },
): PercentBox | undefined {
  const { deviceWidth: w, deviceHeight: h } = viewport;
  if (w <= 0 || h <= 0 || bounds.width <= 0 || bounds.height <= 0) return undefined;
  const left = clamp((bounds.x / w) * 100);
  const top = clamp((bounds.y / h) * 100);
  const right = clamp(((bounds.x + bounds.width) / w) * 100);
  const bottom = clamp(((bounds.y + bounds.height) / h) * 100);
  if (right - left <= 0 || bottom - top <= 0) return undefined;
  return { left, top, width: right - left, height: bottom - top };
}

/** Confidence bands used for the reticle colour and the timeline marks. */
export function confidenceBand(p: number | undefined): "high" | "mid" | "low" | "none" {
  if (p === undefined) return "none";
  if (p >= 0.85) return "high";
  if (p >= 0.7) return "mid";
  return "low";
}
