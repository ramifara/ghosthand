// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Image facts for the direct TypeSafe API (docs/research/notes/jev-1-14-images-box.md, ADR 0020):
// documented limits, the measured token curve, and header sniffing so a bad image never costs a request.
import type { ImageLimits } from "@ghosthand/protocol";

export { estimateImageTokens, readImageSize, sniffImageType } from "@ghosthand/core";

/** Opt-in header TypeSafe requires on every request that carries an image or a box question. */
export const IMAGES_HEADER = "TypeSafe-Danger-Zone-Images";

/** Documented limits (inclusive). Out-of-range images are rejected by the API, never resized. */
export const TYPESAFE_IMAGE_LIMITS: ImageLimits = {
  minSide: 280,
  maxSide: 1568,
  minPixels: 78_400,
  maxPixels: 2_458_624,
  maxBytes: 16 * 1024 * 1024,
};

/** How often `ref` occurs in `text` as a plain substring (each use sends the image again). */
export function countRefUses(text: string, ref: string): number {
  let n = 0;
  for (let i = text.indexOf(ref); i !== -1; i = text.indexOf(ref, i + ref.length)) n++;
  return n;
}
