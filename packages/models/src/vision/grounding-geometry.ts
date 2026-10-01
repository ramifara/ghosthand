// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Coordinate conversions for grounding: model output space → screenshot image pixels.
import type { GroundingConvention } from "../catalog/ghosthand-fields.ts";

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** Anthropic resizes images whose long edge exceeds 1568 px or whose area exceeds ~1.15 MP. */
export const ANTHROPIC_MAX_LONG_EDGE = 1568;
export const ANTHROPIC_MAX_PIXELS = 1_150_000;

/**
 * The factor Anthropic's API applies to an image before Claude sees it (≤ 1). Claude's
 * coordinates are in that resized space, so divide by this factor to get image pixels.
 * Model-layer note §1: "Downscale to <=1568 px long edge and ~1.15 MP, scale back."
 */
export function anthropicImageScale(size: ImageSize): number {
  const long = Math.max(size.width, size.height);
  const area = size.width * size.height;
  if (long <= 0 || area <= 0) return 1;
  return Math.min(1, ANTHROPIC_MAX_LONG_EDGE / long, Math.sqrt(ANTHROPIC_MAX_PIXELS / area));
}

/** The grid the model is asked to answer on. `none` falls back to pixels. */
export function gridFor(convention: GroundingConvention): "pixels" | "norm1000" | "norm999" {
  return convention === "none" ? "pixels" : convention;
}

function clamp(v: number, max: number): number {
  return Math.min(Math.max(0, v), Math.max(0, max - 1));
}

/** Converts a point from the model's grid to image pixels, rounded and clamped to the image. */
export function toImagePixels(
  point: { readonly x: number; readonly y: number },
  convention: GroundingConvention,
  size: ImageSize,
): { x: number; y: number } {
  const grid = gridFor(convention);
  const span = grid === "norm1000" ? 1000 : grid === "norm999" ? 999 : undefined;
  const x = span === undefined ? point.x : (point.x / span) * size.width;
  const y = span === undefined ? point.y : (point.y / span) * size.height;
  return { x: Math.round(clamp(x, size.width)), y: Math.round(clamp(y, size.height)) };
}

/** True when a raw model point lies inside the grid (before clamping). */
export function insideGrid(
  point: { readonly x: number; readonly y: number },
  convention: GroundingConvention,
  size: ImageSize,
): boolean {
  const grid = gridFor(convention);
  const maxX = grid === "norm1000" ? 1000 : grid === "norm999" ? 999 : size.width;
  const maxY = grid === "norm1000" ? 1000 : grid === "norm999" ? 999 : size.height;
  return point.x >= 0 && point.y >= 0 && point.x <= maxX && point.y <= maxY;
}
