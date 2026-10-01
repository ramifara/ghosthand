// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { APICallError, LoadAPIKeyError, NoObjectGeneratedError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { kindForStatus, mapModelError, retryAfterMs } from "./map-model-error.ts";

const ctx = { timedOut: false, callerAborted: false, timeoutMs: 1000 };

function apiError(statusCode: number | undefined, headers?: Record<string, string>, isRetryable?: boolean) {
  return new APICallError({
    message: "provider says no",
    url: "https://api.openai.com/v1/responses",
    requestBodyValues: { input: "secret prompt" },
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(headers !== undefined ? { responseHeaders: headers } : {}),
    ...(isRetryable !== undefined ? { isRetryable } : {}),
  });
}

const usage = {
  inputTokens: 10,
  inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 5,
  outputTokenDetails: { textTokens: 5, reasoningTokens: 0 },
  totalTokens: 15,
};

function noObject(finishReason: "stop" | "length" | "content-filter") {
  return new NoObjectGeneratedError({
    message: "could not parse",
    text: "{",
    response: { id: "r", timestamp: new Date(0), modelId: "m" },
    usage,
    finishReason,
  });
}

describe("kindForStatus", () => {
  it.each([
    [401, "auth"],
    [403, "auth"],
    [404, "not_configured"],
    [408, "timeout"],
    [429, "rate_limit"],
    [400, "unknown"],
    [422, "unknown"],
    [500, "server"],
    [503, "server"],
  ] as const)("%i → %s", (status, kind) => {
    expect(kindForStatus(status)).toBe(kind);
  });
});

describe("retryAfterMs", () => {
  it("prefers retry-after-ms, then retry-after seconds", () => {
    expect(retryAfterMs({ "retry-after-ms": "750", "retry-after": "2" })).toBe(750);
    expect(retryAfterMs({ "Retry-After": "3" })).toBe(3000);
    expect(retryAfterMs({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" })).toBeUndefined();
    expect(retryAfterMs(undefined)).toBeUndefined();
  });
});

describe("mapModelError", () => {
  it("maps API errors by status with the retry hint, never the request body", () => {
    const e = mapModelError(apiError(429, { "retry-after-ms": "1200" }), ctx);
    expect(e).toEqual({
      kind: "rate_limit",
      message: "HTTP 429: provider says no",
      status: 429,
      retryAfterMs: 1200,
    });
    expect(JSON.stringify(e)).not.toContain("secret prompt");
  });

  it("maps connection failures to network", () => {
    expect(mapModelError(apiError(undefined, undefined, true), ctx).kind).toBe("network");
    expect(mapModelError(new TypeError("fetch failed"), ctx).kind).toBe("network");
  });

  it("unwraps retry errors", () => {
    const retry = new RetryError({
      message: "failed after 3",
      reason: "maxRetriesExceeded",
      errors: [apiError(503)],
    });
    expect(mapModelError(retry, ctx).kind).toBe("server");
    const aborted = new RetryError({ message: "aborted", reason: "abort", errors: [] });
    expect(mapModelError(aborted, ctx).kind).toBe("aborted");
  });

  it("maps schema failures and content filtering", () => {
    expect(mapModelError(noObject("stop"), ctx).kind).toBe("schema_failed");
    expect(mapModelError(noObject("length"), ctx).message).toContain("token limit");
    expect(mapModelError(noObject("content-filter"), ctx).kind).toBe("refused");
  });

  it("lets our own timer and the caller's signal decide abort kinds", () => {
    const abort = new DOMException("aborted", "AbortError");
    expect(mapModelError(abort, { ...ctx, timedOut: true }).kind).toBe("timeout");
    expect(mapModelError(abort, { ...ctx, callerAborted: true }).kind).toBe("aborted");
    expect(mapModelError(abort, ctx).kind).toBe("aborted");
  });

  it("maps a missing key and unknown throwables", () => {
    expect(mapModelError(new LoadAPIKeyError({ message: "no key" }), ctx).kind).toBe("not_configured");
    expect(mapModelError("weird", ctx)).toEqual({ kind: "unknown", message: "weird" });
  });
});
