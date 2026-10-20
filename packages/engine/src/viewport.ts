// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The web driver cannot downscale a screenshot, so when screenshots go to Jev (ADR 0020) the viewport
// itself stays within TypeSafe's image limits: longest side at most 1568 px, each side at least 280 px.
import { JEV_IMAGE_LIMITS } from "@ghosthand/core";
import type { DecisionImages } from "@ghosthand/protocol";

export interface ViewportSize {
  width: number;
  height: number;
}

export function clampViewportForImages(viewport: ViewportSize, images: DecisionImages): ViewportSize {
  if (images === "off") return viewport;
  const { minSide, maxSide } = JEV_IMAGE_LIMITS;
  let { width, height } = viewport;
  const longest = Math.max(width, height);
  if (longest > maxSide) {
    const ratio = maxSide / longest;
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  return { width: Math.max(minSide, width), height: Math.max(minSide, height) };
}
