// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Small readers over the oracle state snapshot.
import type { AuditRow, TestbedState, UserRow } from "./control-schemas.ts";
import type { OrderRow } from "./orders.ts";
import type { SettingsRow } from "./settings.ts";

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

export function findOrder(orders: readonly OrderRow[], id: string): OrderRow | undefined {
  return orders.find((o) => o.id === id);
}

/** The single order placed by `customerName` on `placedOn`, or undefined when there are none or several. */
export function findOrderBy(
  orders: readonly OrderRow[],
  customerName: string,
  placedOn: string,
): OrderRow | undefined {
  const matches = orders.filter((o) => o.customerName === customerName && o.placedOn === placedOn);
  return matches.length === 1 ? matches[0] : undefined;
}

export function sameOrder(a: OrderRow | undefined, b: OrderRow | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.customerId === b.customerId &&
    a.customerName === b.customerName &&
    a.placedOn === b.placedOn &&
    a.amountCents === b.amountCents &&
    a.status === b.status &&
    a.note === b.note &&
    a.deletedAt === b.deletedAt &&
    a.tags.length === b.tags.length &&
    a.tags.every((t, i) => b.tags[i] === t)
  );
}

/** Every field of order `id` except `fields` still matches the seed. */
export function orderUnchangedExcept(
  state: TestbedState,
  id: string,
  fields: readonly (keyof OrderRow)[],
): boolean {
  const now = findOrder(state.orders, id);
  const before = findOrder(state.initialOrders, id);
  if (!now || !before) return false;
  const skip = new Set<keyof OrderRow>(fields);
  if (skip.has("customerId")) skip.add("customerName");
  const restored: Partial<OrderRow> = Object.fromEntries([...skip].map((k) => [k, before[k]]));
  return sameOrder({ ...now, ...restored }, before);
}

/** No order was added, and every seeded order except `exceptIds` is exactly as seeded. */
export function otherOrdersUnchanged(state: TestbedState, exceptIds: readonly string[] = []): boolean {
  if (state.orders.length !== state.initialOrders.length) return false;
  const skip = new Set(exceptIds);
  return state.initialOrders
    .filter((o) => !skip.has(o.id))
    .every((o) => sameOrder(o, findOrder(state.orders, o.id)));
}

export function findSettings(rows: readonly SettingsRow[], userId: number): SettingsRow | undefined {
  return rows.find((r) => r.userId === userId);
}

function sameSettings(a: SettingsRow | undefined, b: SettingsRow | undefined): boolean {
  if (!a || !b) return false;
  return (Object.keys(a) as (keyof SettingsRow)[]).every((k) => a[k] === b[k]);
}

/** Every setting of `userId` except `fields` still matches the seed. */
export function settingsUnchangedExcept(
  state: TestbedState,
  userId: number,
  fields: readonly (keyof SettingsRow)[],
): boolean {
  const now = findSettings(state.settings, userId);
  const before = findSettings(state.initialSettings, userId);
  if (!now || !before) return false;
  const restored: Partial<SettingsRow> = Object.fromEntries(fields.map((f) => [f, before[f]]));
  return sameSettings({ ...now, ...restored }, before);
}

/** Every user's settings except `exceptUserId` match the seed, and no row was added or removed. */
export function otherSettingsUnchanged(state: TestbedState, exceptUserId?: number): boolean {
  if (state.settings.length !== state.initialSettings.length) return false;
  return state.initialSettings
    .filter((r) => r.userId !== exceptUserId)
    .every((r) => sameSettings(r, findSettings(state.settings, r.userId)));
}

/** Every bio except `exceptUserId` matches the seed, and no row was added or removed. */
export function otherBiosUnchanged(state: TestbedState, exceptUserId?: number): boolean {
  if (state.bios.length !== state.initialBios.length) return false;
  return state.initialBios
    .filter((b) => b.userId !== exceptUserId)
    .every((b) => state.bios.find((x) => x.userId === b.userId)?.html === b.html);
}

/** Every successful app action (sign-in and sign-out aside) is one of `allowed`. */
export function onlyActions(state: TestbedState, allowed: readonly string[]): boolean {
  return appAudit(state)
    .filter((r) => r.outcome === "ok" && !r.action.startsWith("auth."))
    .every((r) => allowed.includes(r.action));
}

/** Successful app audit rows for `action`, oldest first. */
export function okActions(state: TestbedState, action: string): AuditRow[] {
  return appAudit(state).filter((r) => r.action === action && r.outcome === "ok");
}

/**
 * True when the answer names order `id` ("ord_1023", "ORD-1023" or just "1023") and no other order.
 * Listing several orders doesn't count as an answer.
 */
export function answerMentionsOrder(answer: string | undefined, id: string): boolean {
  if (answer === undefined) return false;
  const digits = id.replace(/\D/g, "");
  const named = [...answer.matchAll(/ord[\s_-]?(\d+)/gi)].map((m) => m[1]);
  if (named.length > 0) return named.every((d) => d === digits);
  return new RegExp(`(^|[^0-9])${digits}([^0-9]|$)`).test(answer);
}
