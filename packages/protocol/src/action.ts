// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { z } from "zod";

/** Targets for actions. Tokens are preferred; coordinates are a fallback for vision routes. */
export const TokenTarget = z.object({ token: z.string().min(1) });
export const CaptureTarget = z.object({ captureId: z.string().min(1), x: z.number(), y: z.number() });
export const ScreenTarget = z.object({ screenX: z.number(), screenY: z.number() });
export const PointerTarget = z.union([TokenTarget, CaptureTarget, ScreenTarget]);
export type PointerTarget = z.infer<typeof PointerTarget>;

/** A value typed into a field: either literal text or a reference to a registered secret. */
export const SecretRef = z.object({ secretRef: z.string().regex(/^[A-Za-z0-9_.-]+$/) });
export type SecretRef = z.infer<typeof SecretRef>;
export const FieldValue = z.union([z.string(), SecretRef]);
export type FieldValue = z.infer<typeof FieldValue>;

export const KeyName = z.string().min(1);

export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("press"), token: z.string().min(1) }),
  z.object({ type: z.literal("set_value"), token: z.string().min(1), value: FieldValue }),
  z.object({ type: z.literal("toggle"), token: z.string().min(1), checked: z.boolean().optional() }),
  z.object({ type: z.literal("select_option"), token: z.string().min(1), option: z.string() }),
  z.object({ type: z.literal("focus"), token: z.string().min(1) }),
  z.object({ type: z.literal("scroll_into_view"), token: z.string().min(1) }),
  z.object({ type: z.literal("navigate"), url: z.string().min(1) }),
  z.object({ type: z.literal("back") }),
  z.object({
    type: z.literal("click"),
    target: PointerTarget,
    button: z.enum(["left", "right", "middle"]).optional(),
    count: z.number().int().min(1).max(3).optional(),
  }),
  z.object({ type: z.literal("move"), target: PointerTarget }),
  z.object({ type: z.literal("drag"), from: PointerTarget, to: PointerTarget }),
  z.object({
    type: z.literal("scroll"),
    target: PointerTarget.optional(),
    dx: z.number(),
    dy: z.number(),
  }),
  z.object({ type: z.literal("type_text"), text: FieldValue }),
  z.object({ type: z.literal("key"), keys: z.array(KeyName).min(1) }),
  z.object({ type: z.literal("fill_credential"), token: z.string().min(1), name: z.string().min(1) }),
  z.object({ type: z.literal("fill_totp"), token: z.string().min(1), name: z.string().min(1) }),
  z.object({ type: z.literal("wait"), ms: z.number().int().min(0).max(30_000) }),
]);
export type Action = z.infer<typeof Action>;
export type ActionType = Action["type"];

/**
 * What code observed after an action.
 * - confirmed: read-back shows the intended change.
 * - partial: some change, not all of it.
 * - unverifiable: the action ran but no check could confirm it.
 * - suspected_noop: nothing observable changed.
 * - refused: the action was not executed (stale token, gate, origin guard, ...).
 */
export const Effect = z.enum(["confirmed", "partial", "unverifiable", "suspected_noop", "refused"]);
export type Effect = z.infer<typeof Effect>;

/** The route that executed the action: semantic APIs first, input injection as fallback. */
export const ActionRoute = z.enum(["semantic", "pointer", "keyboard", "navigation", "tool", "none"]);
export type ActionRoute = z.infer<typeof ActionRoute>;

export const Evidence = z.object({
  kind: z.enum(["value", "url", "state", "dom", "network", "dialog", "none"]),
  before: z.string().optional(),
  after: z.string().optional(),
  detail: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const ActionErrorKind = z.enum([
  "stale_token",
  "not_found",
  "not_interactable",
  "hit_test_failed",
  "origin_blocked",
  "secret_missing",
  "timeout",
  "unsupported",
  "driver",
]);
export type ActionErrorKind = z.infer<typeof ActionErrorKind>;

export const ActionError = z.object({ kind: ActionErrorKind, message: z.string() });
export type ActionError = z.infer<typeof ActionError>;

export const ActionResult = z.object({
  effect: Effect,
  route: ActionRoute,
  evidence: z.array(Evidence),
  error: ActionError.optional(),
  /** Snapshot ids whose tokens can no longer be trusted. */
  invalidatedSnapshots: z.array(z.string()),
  durationMs: z.number().nonnegative(),
});
export type ActionResult = z.infer<typeof ActionResult>;
