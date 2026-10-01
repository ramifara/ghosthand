// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Downscales PNG screenshots to small JPEG thumbnails for the single-file report, using a canvas in a
// blank page of the run's own browser (no image library needed, no network, no site CSP involved).
import type { BrowserContext } from "playwright-core";

export const THUMB_WIDTH = 320;

export async function makeThumbnails(
  context: BrowserContext,
  images: Uint8Array[],
  width = THUMB_WIDTH,
): Promise<Array<Uint8Array | undefined>> {
  if (images.length === 0) return [];
  let page: Awaited<ReturnType<BrowserContext["newPage"]>> | undefined;
  try {
    page = await context.newPage();
    const out: Array<Uint8Array | undefined> = [];
    for (const png of images) {
      const b64 = Buffer.from(png).toString("base64");
      // A string script: the engine compiles without DOM types.
      const jpeg: unknown = await page.evaluate(`(async () => {
        const img = new Image();
        img.src = "data:image/png;base64,${b64}";
        await img.decode();
        const scale = Math.min(1, ${width} / img.naturalWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.6).split(",")[1] || "";
      })()`);
      out.push(typeof jpeg === "string" && jpeg ? new Uint8Array(Buffer.from(jpeg, "base64")) : undefined);
    }
    return out;
  } catch {
    return images.map(() => undefined);
  } finally {
    await page?.close().catch(() => {});
  }
}
