// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Recipe trust (ADR 0010): a learned recipe starts at 0.6; each verified replay moves it toward 1, a healed
// replay half as much; a failure multiplies it by 0.6. Trust decays with a 60-day half-life since the last
// success. A recipe is used while it is active, has fewer than two consecutive failures and its effective
// trust is at least 0.3. Two consecutive failures retire it until a successful run re-learns it.
import type { Recipe } from "./recipe-schema.ts";

export const INITIAL_TRUST = 0.6;
export const USE_THRESHOLD = 0.3;
export const RETIRE_AFTER = 2;
export const HALF_LIFE_DAYS = 60;
const DAY_MS = 86_400_000;

export function effectiveTrust(
  r: Pick<Recipe, "trust" | "lastSuccessAt" | "createdAt">,
  now: number,
): number {
  const since = Math.max(0, now - (r.lastSuccessAt ?? r.createdAt)) / DAY_MS;
  return r.trust * 0.5 ** (since / HALF_LIFE_DAYS);
}

export function usable(r: Recipe, now: number): boolean {
  return (
    r.status === "active" && r.consecutiveFailures < RETIRE_AFTER && effectiveTrust(r, now) >= USE_THRESHOLD
  );
}

export function afterSuccess(r: Recipe, healed: boolean, now: number): Recipe {
  const gain = healed ? 0.15 : 0.3;
  return {
    ...r,
    trust: Math.min(1, r.trust + (1 - r.trust) * gain),
    successes: r.successes + 1,
    consecutiveFailures: 0,
    lastSuccessAt: now,
    updatedAt: now,
  };
}

export function afterFailure(r: Recipe, now: number): Recipe {
  const consecutiveFailures = r.consecutiveFailures + 1;
  return {
    ...r,
    trust: r.trust * 0.6,
    failures: r.failures + 1,
    consecutiveFailures,
    status: consecutiveFailures >= RETIRE_AFTER ? "retired" : r.status,
    updatedAt: now,
  };
}
