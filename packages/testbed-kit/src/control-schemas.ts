// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Wire shapes of the testbed control API (:4401) and the state snapshot oracles read.
import { z } from "zod";
import { StatusRow } from "./auth.ts";
import { CartItemRow, PickupStoreRow } from "./catalog.ts";
import { LabState } from "./lab.ts";
import { CustomerRow, OrderRow } from "./orders.ts";
import { ContactPrefsRow } from "./preferences.ts";
import { BioRow, SettingsRow } from "./settings.ts";
import { Variant, VariantOverrides } from "./variant.ts";

export const UserRow = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string(),
  handle: z.string(),
  title: z.string(),
  website: z.string(),
  bio: z.string(),
});
export type UserRow = z.infer<typeof UserRow>;

export const SessionRow = z.object({ userId: z.number().int(), createdAt: z.string() });
export type SessionRow = z.infer<typeof SessionRow>;

export const AuditOutcome = z.enum(["ok", "rejected", "error"]);
export type AuditOutcome = z.infer<typeof AuditOutcome>;

export const AuditRow = z.object({
  id: z.number().int(),
  at: z.string(),
  /** User email, "anonymous", or "control" for control-API calls. */
  actor: z.string(),
  method: z.string(),
  path: z.string(),
  /** Dotted action name, e.g. "auth.login" or "profile.update". */
  action: z.string(),
  outcome: AuditOutcome,
  detail: z.record(z.string(), z.unknown()),
});
export type AuditRow = z.infer<typeof AuditRow>;

export const MailRow = z.object({
  id: z.number().int(),
  at: z.string(),
  to: z.string(),
  from: z.string(),
  subject: z.string(),
  body: z.string(),
});
export type MailRow = z.infer<typeof MailRow>;

/** Everything an oracle may look at. Built by the server from the DB, never from the page. */
export const TestbedState = z.object({
  seed: z.number().int(),
  variant: Variant,
  now: z.string(),
  users: z.array(UserRow),
  /** Users exactly as the last reset seeded them, for "nothing else changed" checks. */
  initialUsers: z.array(UserRow),
  sessions: z.array(SessionRow),
  audit: z.array(AuditRow),
  mail: z.array(MailRow),
  customers: z.array(CustomerRow),
  /** Every order, including soft-deleted ones (`deletedAt` set). */
  orders: z.array(OrderRow),
  /** Orders as the last reset (plus named seeds) left them. */
  initialOrders: z.array(OrderRow),
  settings: z.array(SettingsRow),
  initialSettings: z.array(SettingsRow),
  bios: z.array(BioRow),
  initialBios: z.array(BioRow),
  /** Catalog carts (P1-06 big page). */
  cart: z.array(CartItemRow),
  pickupStores: z.array(PickupStoreRow),
  /** L4 lab pages (iframes, shadow DOM, drag and drop, upload, scrolling, menus); see `lab.ts`. */
  lab: LabState.optional(),
  initialLab: LabState.optional(),
  /** L5 status messages (session-expiry task); rows exist only after a save. */
  statuses: z.array(StatusRow).optional(),
  /** L6 contact preferences; rows exist only after a save (defaults: DEFAULT_CONTACT_PREFS). */
  contactPrefs: z.array(ContactPrefsRow).optional(),
});
export type TestbedState = z.infer<typeof TestbedState>;

export const OracleResult = z.object({
  pass: z.boolean(),
  checks: z.record(z.string(), z.boolean()),
});
export type OracleResult = z.infer<typeof OracleResult>;

export const ResetRequest = z.object({
  seed: z.number().int().nonnegative().optional(),
  variant: VariantOverrides.optional(),
});
export type ResetRequest = z.infer<typeof ResetRequest>;

export const ResetResponse = z.object({
  seed: z.number().int(),
  variant: Variant,
  resetId: z.number().int(),
});
export type ResetResponse = z.infer<typeof ResetResponse>;

export const SeedResponse = z.object({ name: z.string(), applied: z.boolean() });
export type SeedResponse = z.infer<typeof SeedResponse>;

export const ClockRequest = z.object({ iso: z.iso.datetime() });
export const ClockResponse = z.object({ now: z.string() });
export type ClockResponse = z.infer<typeof ClockResponse>;

export const MailResponse = z.object({ messages: z.array(MailRow) });
export type MailResponse = z.infer<typeof MailResponse>;

export const SessionRequest = z.object({ email: z.string().min(1) });
export const SessionResponse = z.object({ cookie: z.object({ name: z.string(), value: z.string() }) });
export type SessionResponse = z.infer<typeof SessionResponse>;

/** Combines named boolean checks into an oracle verdict: pass only when every check holds. */
export function verdict(checks: Record<string, boolean>): OracleResult {
  return { pass: Object.values(checks).every(Boolean), checks };
}
