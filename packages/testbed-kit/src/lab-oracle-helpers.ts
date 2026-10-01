// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Readers over the lab part of the oracle snapshot (L4).
import type { TestbedState } from "./control-schemas.ts";
import { ALICE_EMAIL } from "./fixtures.ts";
import { EMPTY_LAB, type LabState } from "./lab.ts";
import { findUser } from "./oracle-helpers.ts";

export function labOf(state: TestbedState): LabState {
  return state.lab ?? EMPTY_LAB;
}

export function initialLabOf(state: TestbedState): LabState {
  return state.initialLab ?? EMPTY_LAB;
}

export function aliceId(state: TestbedState): number | undefined {
  return findUser(state.users, ALICE_EMAIL)?.id;
}

/** JSON equality for plain rows (same key order, as the server writes them). */
export function sameRows(a: readonly unknown[], b: readonly unknown[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * True when `answer` states `n` as a standalone number and does not just list the chart: at most one of
 * the `others` appears too (a person may mention a neighbouring bar).
 */
export function answerStatesNumber(
  answer: string | undefined,
  n: number,
  others: readonly number[],
): boolean {
  if (answer === undefined) return false;
  const numbers = [...answer.matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (!numbers.includes(n)) return false;
  return others.filter((o) => o !== n && numbers.includes(o)).length <= 1;
}
