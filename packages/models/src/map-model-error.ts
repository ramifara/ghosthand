// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Maps AI SDK exceptions to ModelError. Never throws.
import {
  APICallError,
  JSONParseError,
  LoadAPIKeyError,
  NoContentGeneratedError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  RetryError,
  TypeValidationError,
} from "ai";
import type { ModelError, ModelErrorKind } from "./model-error.ts";

export function kindForStatus(status: number): ModelErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  // The model id is unknown to this key or account.
  if (status === 404) return "not_configured";
  if (status >= 500) return "server";
  return "unknown";
}

/** `retry-after-ms` (OpenAI) or `retry-after` in seconds. */
export function retryAfterMs(headers: Readonly<Record<string, string>> | undefined): number | undefined {
  if (headers === undefined) return undefined;
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const ms = Number(lower["retry-after-ms"]);
  if (Number.isFinite(ms) && ms >= 0 && lower["retry-after-ms"] !== undefined) return ms;
  const s = Number(lower["retry-after"]);
  if (Number.isFinite(s) && s >= 0 && lower["retry-after"] !== undefined) return s * 1000;
  return undefined;
}

export interface MapErrorContext {
  /** Our per-attempt timer fired. */
  readonly timedOut: boolean;
  /** The caller's signal fired. */
  readonly callerAborted: boolean;
  readonly timeoutMs: number;
}

type MappedError = Pick<ModelError, "kind" | "message" | "status" | "retryAfterMs">;

function isAbortLike(e: unknown): boolean {
  return (
    (e instanceof Error || (typeof DOMException === "function" && e instanceof DOMException)) &&
    (e.name === "AbortError" || e.name === "TimeoutError" || e.name === "ResponseAborted")
  );
}

/** Only the provider's own message; request bodies (which hold prompts) are never included. */
function apiMessage(e: APICallError): string {
  return e.statusCode === undefined ? e.message : `HTTP ${e.statusCode}: ${e.message}`;
}

export function mapModelError(e: unknown, ctx: MapErrorContext): MappedError {
  // Our own signals decide first: the SDK surfaces both as an abort.
  if (ctx.callerAborted) return { kind: "aborted", message: "aborted by caller" };
  if (ctx.timedOut) return { kind: "timeout", message: `no response within ${ctx.timeoutMs} ms` };

  if (RetryError.isInstance(e)) {
    if (e.reason === "abort") return { kind: "aborted", message: e.message };
    return mapModelError(e.lastError, ctx);
  }
  if (APICallError.isInstance(e)) {
    if (e.statusCode === undefined) {
      return { kind: e.isRetryable ? "network" : "unknown", message: apiMessage(e) };
    }
    const out: { -readonly [K in keyof MappedError]: MappedError[K] } = {
      kind: kindForStatus(e.statusCode),
      message: apiMessage(e),
      status: e.statusCode,
    };
    const after = retryAfterMs(e.responseHeaders);
    if (after !== undefined) out.retryAfterMs = after;
    return out;
  }
  if (NoObjectGeneratedError.isInstance(e)) {
    if (e.finishReason === "content-filter")
      return { kind: "refused", message: "the provider filtered the output" };
    const truncated = e.finishReason === "length" ? " (output hit the token limit)" : "";
    const raw = typeof e.text === "string" ? e.text.trim().slice(0, 400) : "";
    return {
      kind: "schema_failed",
      message: `output did not match the schema${truncated}: ${e.message}${raw ? ` · answer: ${raw.slice(0, 160)}` : " · answer: (empty)"}`,
      ...(raw ? { rawText: raw } : {}),
    };
  }
  if (TypeValidationError.isInstance(e) || JSONParseError.isInstance(e)) {
    return { kind: "schema_failed", message: e.message };
  }
  if (NoOutputGeneratedError.isInstance(e) || NoContentGeneratedError.isInstance(e)) {
    return { kind: "schema_failed", message: `no output: ${e.message}` };
  }
  if (LoadAPIKeyError.isInstance(e)) return { kind: "not_configured", message: e.message };
  if (isAbortLike(e)) return { kind: "aborted", message: e instanceof Error ? e.message : "aborted" };
  if (e instanceof TypeError && /fetch failed|failed to fetch|network/i.test(e.message)) {
    return { kind: "network", message: e.message };
  }
  return { kind: "unknown", message: e instanceof Error ? e.message : String(e) };
}
