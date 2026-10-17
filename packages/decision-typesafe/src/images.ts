// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Image facts for the direct TypeSafe API (docs/research/notes/jev-1-14-images-box.md, ADR 0020):
// documented limits, the measured token curve, and header sniffing so a bad image never costs a request.
import type { ImageLimits, ImageMimeType } from "@ghosthand/protocol";

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

/**
 * Input tokens one use of an image costs. Measured 2026-10-17 on 280² … 1568×1022 screenshots within ±5 %:
 * a flat part plus one token per 385 pixels. PNG and JPEG cost the same.
 */
export function estimateImageTokens(width: number, height: number): number {
  return 240 + Math.ceil((width * height) / 385);
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The image type the file bytes declare, or undefined for anything that is not PNG or JPEG. */
export function sniffImageType(bytes: Uint8Array): ImageMimeType | undefined {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return undefined;
}

/** Width and height from a PNG IHDR or a JPEG SOF segment, or undefined when unreadable. */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const type = sniffImageType(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/png") {
    if (bytes.length < 24) return undefined;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type === "image/jpeg") {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return undefined;
      const marker = bytes[i + 1] ?? 0;
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
      }
      i += 2 + view.getUint16(i + 2);
    }
  }
  return undefined;
}

/** How often `ref` occurs in `text` as a plain substring (each use sends the image again). */
export function countRefUses(text: string, ref: string): number {
  let n = 0;
  for (let i = text.indexOf(ref); i !== -1; i = text.indexOf(ref, i + ref.length)) n++;
  return n;
}
