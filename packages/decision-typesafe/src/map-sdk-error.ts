// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Maps every `@typesafe-ai/sdk` exception to a vendor-neutral DecisionError. Never throws.
import type { DecisionError, DecisionErrorKind } from "@ghosthand/protocol";
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  RateLimitError,
  TypeSafeError,
} from "@typesafe-ai/sdk";

/** Over-context: measured 2026-10-01 as 400 `{"detail":{"error_type":"max_tokens_exceeded"}}`; 413/422 kept for safety. */
const CONTEXT_MESSAGE = /max_tokens_exceeded|context|token|too long|too large|length/i;
/**
 * Image and asset rejections (measured 2026-10-17): "Invalid image dimensions.", "Images are experimental.
 * Send the header …", unreferenced assets, and a box question on a model without box support, which the
 * API reports as a bare "Invalid request.".
 */
const IMAGE_MESSAGE = /image|asset|dimension|experimental|multipart|^400 Invalid request\.$/i;

export function kindForStatus(status: number, message: string): DecisionErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 529) return "overloaded";
  if (status === 408) return "timeout";
  if (status === 413) return "too_large";
  if (status === 400 || status === 422) {
    if (CONTEXT_MESSAGE.test(message)) return "too_large";
    if (status === 400 && IMAGE_MESSAGE.test(message)) return "image_rejected";
    return "invalid";
  }
  if (status === 404) return "invalid";
  if (status >= 500) return "server";
  return "unknown";
}

export function mapSdkError(e: unknown, provider = "typesafe"): DecisionError {
  if (e instanceof APIError) {
    const out: DecisionError = {
      kind: kindForStatus(e.status, e.message),
      message: e.message,
      provider,
      status: e.status,
    };
    if (e.requestId !== undefined) out.requestId = e.requestId;
    if (e instanceof RateLimitError && e.retryAfterMs !== undefined) out.retryAfterMs = e.retryAfterMs;
    return out;
  }
  // APITimeoutError extends APIConnectionError, so check it first.
  if (e instanceof APITimeoutError) return { kind: "timeout", message: e.message, provider };
  if (e instanceof APIConnectionError) return { kind: "network", message: e.message, provider };
  if (e instanceof APIUserAbortError) return { kind: "aborted", message: e.message, provider };
  // Base class: client-side configuration or question validation.
  if (e instanceof TypeSafeError) return { kind: "invalid", message: e.message, provider };
  if (e instanceof Error && e.name === "AbortError") return { kind: "aborted", message: e.message, provider };
  return { kind: "unknown", message: e instanceof Error ? e.message : String(e), provider };
}
