// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The server reads time only through a Clock. The testbed clock is frozen so runs are reproducible;
// the harness moves it with `POST /clock`.

export interface Clock {
  /** Current time as an ISO 8601 string. */
  now(): string;
  set(iso: string): void;
}

export function createFrozenClock(iso: string): Clock {
  let current = new Date(iso).toISOString();
  return {
    now: () => current,
    set(next) {
      current = new Date(next).toISOString();
    },
  };
}
