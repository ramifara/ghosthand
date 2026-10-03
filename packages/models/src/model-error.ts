// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Vendor-neutral errors for model calls. Every AI SDK exception is mapped to one of these kinds.
import { z } from "zod";

export const ModelErrorKind = z.enum([
  /** No usable model for the role: unbound role, unknown model, unmet requirement, or no key. */
  "not_configured",
  "auth",
  "rate_limit",
  "timeout",
  /** The caller's signal fired. */
  "aborted",
  /** The model answered but the output did not parse or match the schema. */
  "schema_failed",
  /** The provider's content filter or the model declined to answer. */
  "refused",
  "server",
  "network",
  /** The spend cap would be exceeded. */
  "budget",
  "unknown",
]);
export type ModelErrorKind = z.infer<typeof ModelErrorKind>;

/** One model tried in a fallback chain and why it failed. */
export interface ModelAttempt {
  readonly model: string;
  readonly kind: ModelErrorKind;
  readonly latencyMs: number;
}

export interface ModelError {
  readonly kind: ModelErrorKind;
  readonly message: string;
  /** For `schema_failed`: the start of what the model actually answered, so callers can salvage and logs show it. */
  readonly rawText?: string;
  readonly role?: string;
  /** Model reference (`provider/model`) of the last attempt, when one was made. */
  readonly model?: string;
  readonly status?: number;
  readonly retryAfterMs?: number;
  /** Every model tried, in order. Present when at least one call was attempted. */
  readonly attempts?: readonly ModelAttempt[];
}

/**
 * Kinds after which the next model in a fallback chain is tried. A caller abort or a spend cap
 * stops the chain, and so does a refusal: another model is not a way around a safety decision.
 */
export const FALLBACK_KINDS: ReadonlySet<ModelErrorKind> = new Set<ModelErrorKind>([
  "not_configured",
  "auth",
  "rate_limit",
  "timeout",
  "schema_failed",
  "server",
  "network",
  "unknown",
]);
