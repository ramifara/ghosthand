// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Layout of one run folder: <runsDir>/<runId>/...
import { join } from "node:path";
import type { ImageMimeType } from "@ghosthand/protocol";

export type RunPaths = {
  readonly folder: string;
  /** One RunEvent per line. */
  readonly events: string;
  /** `step-NNN.png`. */
  readonly screenshotsDir: string;
  /** `step-NNN-<purpose>.json`: rendered decision state sidecars. */
  readonly statesDir: string;
  /** Playwright trace; the driver writes it here. */
  readonly trace: string;
  /** Playwright video directory. */
  readonly videoDir: string;
  /** Per-run pino log file. */
  readonly log: string;
  /** OpenTelemetry file exporter target. */
  readonly otel: string;
  /** Written by `finish()`. */
  readonly summary: string;
};

export const EVENTS_FILE = "events.jsonl";
export const SUMMARY_FILE = "summary.json";
export const INDEX_FILE = "index.sqlite";

export function runPaths(folder: string): RunPaths {
  return {
    folder,
    events: join(folder, EVENTS_FILE),
    screenshotsDir: join(folder, "screenshots"),
    statesDir: join(folder, "states"),
    trace: join(folder, "trace.zip"),
    videoDir: join(folder, "video"),
    log: join(folder, "log.jsonl"),
    otel: join(folder, "otel.jsonl"),
    summary: join(folder, SUMMARY_FILE),
  };
}

const step3 = (step: number): string => String(Math.max(0, Math.trunc(step))).padStart(3, "0");

const slug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * `step-NNN.png`, or `.jpg` for a JPEG capture (ADR 0020). A `label` names an extra capture of the same
 * step (`step-NNN-d0.jpg`: what Jev saw), which is not the step's main screenshot.
 */
export function screenshotName(step: number, mimeType: ImageMimeType = "image/png", label?: string): string {
  const ext = mimeType === "image/jpeg" ? "jpg" : "png";
  const tag = label ? slug(label) : "";
  return `step-${step3(step)}${tag ? `-${tag}` : ""}.${ext}`;
}

/** Purpose is reduced to kebab-case `[a-z0-9-]` so it is always a safe file name segment. */
export function stateName(step: number, purpose: string): string {
  const p =
    purpose
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "state";
  return `step-${step3(step)}-${p}.json`;
}
