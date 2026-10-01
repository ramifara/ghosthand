// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeError,
} from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { mapSdkError } from "./map-sdk-error.ts";

const headers = (extra: Record<string, string> = {}): Headers =>
  new Headers({ "x-typesafe-request-id": "req_00000000000000000000000000000001", ...extra });

const apiError = (status: number, message: string, extra: Record<string, string> = {}): APIError =>
  APIError.fromResponse(status, { detail: { error_type: "x", message } }, headers(extra));

describe("mapSdkError", () => {
  it.each([
    [400, "bad", "invalid"],
    [401, "Invalid API key.", "auth"],
    [403, "Must supply an API key!", "auth"],
    [404, "Model not found", "invalid"],
    [408, "Request timeout", "timeout"],
    [413, "Payload too large", "too_large"],
    [422, "questions.a.criteria: Field required", "invalid"],
    [422, "Input exceeds the context window of 64000 tokens.", "too_large"],
    [429, "slow down", "rate_limit"],
    [500, "boom", "server"],
    [502, "bad gateway", "server"],
    [529, "Overloaded.", "overloaded"],
    [418, "teapot", "unknown"],
  ])("maps %i (%s) to %s", (status, message, kind) => {
    const e = mapSdkError(apiError(status, message));
    expect(e).toMatchObject({
      kind,
      status,
      provider: "typesafe",
      requestId: "req_00000000000000000000000000000001",
    });
    expect(e.message).toContain(message);
  });

  it("carries retryAfterMs on 429", () => {
    expect(mapSdkError(apiError(429, "slow", { "retry-after-ms": "1200" })).retryAfterMs).toBe(1200);
    expect(mapSdkError(apiError(429, "slow", { "retry-after": "2" })).retryAfterMs).toBe(2000);
    expect(mapSdkError(apiError(429, "slow"))).not.toHaveProperty("retryAfterMs");
  });

  it("maps transport errors", () => {
    expect(mapSdkError(new APITimeoutError(2500)).kind).toBe("timeout");
    expect(mapSdkError(new APIConnectionError()).kind).toBe("network");
    expect(mapSdkError(new APIUserAbortError()).kind).toBe("aborted");
  });

  it("maps client-side validation and unknown values without throwing", () => {
    expect(mapSdkError(new TypeSafeError("At least one question is required.")).kind).toBe("invalid");
    expect(mapSdkError(new Error("weird")).kind).toBe("unknown");
    expect(mapSdkError("a string").kind).toBe("unknown");
    expect(mapSdkError(undefined).kind).toBe("unknown");
  });
});
