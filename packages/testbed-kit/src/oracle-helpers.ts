// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Small readers over the oracle state snapshot.
import type { AuditRow, TestbedState, UserRow } from "./control-schemas.ts";

export function findUser(users: readonly UserRow[], email: string): UserRow | undefined {
  return users.find((u) => u.email === email);
}

/** Audit rows caused by the app (excludes control-API calls made by the harness). */
export function appAudit(state: TestbedState): AuditRow[] {
  return state.audit.filter((row) => row.actor !== "control");
}

export function sameUser(a: UserRow | undefined, b: UserRow | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.name === b.name &&
    a.handle === b.handle &&
    a.title === b.title &&
    a.website === b.website &&
    a.bio === b.bio
  );
}

/** True when every seeded user except `exceptEmail` is unchanged and no user was added or removed. */
export function otherUsersUnchanged(state: TestbedState, exceptEmail?: string): boolean {
  if (state.users.length !== state.initialUsers.length) return false;
  return state.initialUsers
    .filter((u) => u.email !== exceptEmail)
    .every((u) => sameUser(u, findUser(state.users, u.email)));
}

/** Lowercases, collapses whitespace and drops trailing punctuation, for comparing reported text. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!\s]+$/, "")
    .trim();
}
