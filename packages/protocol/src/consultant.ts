// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { z } from "zod";

export const ConsultantProbe = z.object({
  installed: z.boolean(),
  version: z.string().optional(),
  /** `claude_ai`: the user's own Claude subscription login inside their `claude` CLI. */
  auth: z.enum(["chatgpt", "claude_ai", "api_key", "none", "unknown"]),
  plan: z.string().optional(),
  models: z.array(z.string()),
});
export type ConsultantProbe = z.infer<typeof ConsultantProbe>;

export const ConsultantErrorKind = z.enum([
  "not_installed",
  "unauthenticated",
  "usage_limit",
  "timeout",
  "cancelled",
  "schema_failed",
  "process",
]);
export type ConsultantErrorKind = z.infer<typeof ConsultantErrorKind>;

export const ConsultantError = z.object({ kind: ConsultantErrorKind, message: z.string() });
export type ConsultantError = z.infer<typeof ConsultantError>;

export const RateLimitWindow = z.object({
  usedPercent: z.number(),
  windowMinutes: z.number().optional(),
  resetsAt: z.number().optional(),
});
export const RateLimits = z.object({
  primary: RateLimitWindow.optional(),
  secondary: RateLimitWindow.optional(),
});
export type RateLimits = z.infer<typeof RateLimits>;
