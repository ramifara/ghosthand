// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The testbed clock as the server reported it at boot. Date pickers use it for "today",
// so they open on the same month in every run.
import { DEFAULT_NOW } from "@ghosthand/testbed-kit/fixtures";

let now = DEFAULT_NOW;

export function setServerNow(iso: string): void {
  if (iso) now = iso;
}

/** Today's date (YYYY-MM-DD) on the testbed clock. */
export function serverToday(): string {
  return now.slice(0, 10);
}
