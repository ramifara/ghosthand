// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Sortable run ids: YYYYMMDD-HHMMSS-<6 base36 random>, in UTC so ids sort by start time.
import { randomInt } from "node:crypto";

export const RUN_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-z]{6}$/;

/** Safe as a single path segment: no separators, no leading dot. */
export const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export function randomSuffix(): string {
  return randomInt(36 ** 6)
    .toString(36)
    .padStart(6, "0");
}

export function createRunId(nowMs: number = Date.now(), suffix: string = randomSuffix()): string {
  const d = new Date(nowMs);
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${date}-${time}-${suffix}`;
}
