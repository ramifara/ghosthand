// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Finds a run's step screenshots on disk. Steps have one main capture, `step-NNN.png` or, since the
// decision model gets JPEG screenshots (ADR 0020), `step-NNN.jpg`; labelled extras (`step-NNN-d0.jpg`)
// are what Jev saw and are not the step's main screenshot.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ImageMimeType } from "@ghosthand/protocol";
import { screenshotName } from "./run-folder.ts";

const MAIN = /^step-(\d+)\.(png|jpg)$/;

/** Steps that have a main screenshot, ascending. Empty when the folder has none. */
export function listScreenshotSteps(folder: string): number[] {
  try {
    return readdirSync(join(folder, "screenshots"))
      .map((f) => MAIN.exec(f)?.[1])
      .filter((s): s is string => s !== undefined)
      .map(Number)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** The step's main screenshot, PNG or JPEG, or undefined. */
export function findScreenshot(
  folder: string,
  step: number,
): { file: string; mimeType: ImageMimeType } | undefined {
  for (const mimeType of ["image/png", "image/jpeg"] as const) {
    const file = join(folder, "screenshots", screenshotName(step, mimeType));
    if (existsSync(file)) return { file, mimeType };
  }
  return undefined;
}
