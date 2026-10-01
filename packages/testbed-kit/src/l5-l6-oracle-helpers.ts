// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Readers over the oracle snapshot for the L5 (auth) and L6 (robustness) tasks.
import type { AuditRow, TestbedState } from "./control-schemas.ts";
import { appAudit, findUser } from "./oracle-helpers.ts";
import { type ContactPrefsRow, DEFAULT_CONTACT_PREFS } from "./preferences.ts";

/** `email` has at least one session and nobody else has one. */
export function onlySessionsFor(state: TestbedState, email: string): boolean {
  const user = findUser(state.users, email);
  if (!user) return false;
  return state.sessions.length > 0 && state.sessions.every((s) => s.userId === user.id);
}

/** App audit rows for `action` with `outcome` (default ok), oldest first. */
export function auditRows(
  state: TestbedState,
  action: string,
  outcome: AuditRow["outcome"] = "ok",
): AuditRow[] {
  return appAudit(state).filter((r) => r.action === action && r.outcome === outcome);
}

/** Every app audit row (any outcome) is one of `allowed`. */
export function onlyAuditActions(state: TestbedState, allowed: readonly string[]): boolean {
  return appAudit(state).every((r) => allowed.includes(r.action));
}

/** The user's contact preferences, falling back to the defaults when they never saved. */
export function contactPrefsFor(state: TestbedState, userId: number): ContactPrefsRow {
  return state.contactPrefs?.find((p) => p.userId === userId) ?? { userId, ...DEFAULT_CONTACT_PREFS };
}

/** The user's preferences equal the defaults with `changes` applied (so nothing else moved). */
export function prefsMatch(
  state: TestbedState,
  userId: number,
  changes: Partial<Omit<ContactPrefsRow, "userId">>,
): boolean {
  const now = contactPrefsFor(state, userId);
  const want: ContactPrefsRow = { userId, ...DEFAULT_CONTACT_PREFS, ...changes };
  return (Object.keys(want) as (keyof ContactPrefsRow)[]).every((k) => now[k] === want[k]);
}

/** No other user has saved preferences. */
export function otherPrefsUntouched(state: TestbedState, userId: number): boolean {
  return (state.contactPrefs ?? []).every((p) => p.userId === userId);
}

/** The user's status message ("" when never saved). */
export function statusFor(state: TestbedState, userId: number): string {
  return state.statuses?.find((s) => s.userId === userId)?.message ?? "";
}

/** Index of the first audit row matching `pred` in the app audit, or -1. */
export function auditIndex(state: TestbedState, pred: (row: AuditRow) => boolean): number {
  return appAudit(state).findIndex(pred);
}

/** Index of the last audit row matching `pred` in the app audit, or -1. */
export function lastAuditIndex(state: TestbedState, pred: (row: AuditRow) => boolean): number {
  return appAudit(state).findLastIndex(pred);
}
