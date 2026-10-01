// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { isSensitiveKey, REDACTED, redactKeys } from "./redact-keys.ts";

describe("redactKeys", () => {
  it("redacts values of sensitive keys at any depth", () => {
    const input = {
      password: "hunter2",
      nested: { userPassword: "x", api_key: "k", accessToken: "a", "Set-Cookie": "c=1" },
      headers: [{ Authorization: "Bearer abc" }, { cookie: "sid=1" }],
      totp: "123456",
      clientSecret: "cs",
    };
    expect(redactKeys(input)).toEqual({
      password: REDACTED,
      nested: { userPassword: REDACTED, api_key: REDACTED, accessToken: REDACTED, "Set-Cookie": REDACTED },
      headers: [{ Authorization: REDACTED }, { cookie: REDACTED }],
      totp: REDACTED,
      clientSecret: REDACTED,
    });
  });

  it("leaves protocol fields that only look sensitive alone", () => {
    const action = { type: "set_value", token: "e12", value: { secretRef: "TESTBED_PASSWORD" } };
    const task = { secrets: ["TESTBED_PASSWORD"], tokenEstimate: 240, stateTokens: 10, inputTokens: 5 };
    expect(redactKeys(action)).toEqual(action);
    expect(redactKeys(task)).toEqual(task);
    for (const k of ["token", "secrets", "secretRef", "tokenEstimate", "stateTokens"]) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });

  it("keeps null and undefined values and does not mutate the input", () => {
    const input = { password: null, other: 1 };
    const out = redactKeys(input);
    expect(out).toEqual({ password: null, other: 1 });
    expect(out).not.toBe(input);
    expect(redactKeys("plain")).toBe("plain");
  });
});
