// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { SecretsRegistry } from "@ghosthand/core";
import { describe, expect, it } from "vitest";
import { isSecretField, redactFieldValue, SecretScope } from "./secret-scope.ts";

const scope = new SecretScope(new SecretsRegistry([["PASSWORD", "hunter2-secret"]]));
const text = { valueKind: "text" as const };
const password = { valueKind: "password" as const, inputType: "password" };

describe("redactFieldValue", () => {
  it("shows empty, placeholder, filled or visible text", () => {
    expect(redactFieldValue("", text, scope)).toBe("<empty>");
    expect(redactFieldValue("hunter2-secret", text, scope)).toBe("[input:PASSWORD]");
    expect(redactFieldValue("hunter2-secret", password, scope)).toBe("[input:PASSWORD]");
    expect(redactFieldValue("anything else", password, scope)).toBe("<filled>");
    expect(redactFieldValue("  ada@example.com ", text, scope)).toBe("ada@example.com");
    expect(redactFieldValue("x hunter2-secret y", text, scope)).toBe("x [input:PASSWORD] y");
    expect(redactFieldValue(undefined, text, scope)).toBeUndefined();
    expect(redactFieldValue("x", { valueKind: "none" }, scope)).toBeUndefined();
  });

  it("treats sensitive names and autocomplete as secret fields", () => {
    expect(isSecretField({ valueKind: "text", fieldName: "api_key" })).toBe(true);
    expect(isSecretField({ valueKind: "text", autocomplete: "one-time-code" })).toBe(true);
    expect(isSecretField({ valueKind: "text", fieldName: "email" })).toBe(false);
    expect(redactFieldValue("123456", { valueKind: "text", autocomplete: "one-time-code" }, scope)).toBe(
      "<filled>",
    );
  });
});

describe("SecretScope", () => {
  it("redacts generated and transient values", () => {
    const s = new SecretScope(new SecretsRegistry([["PASSWORD", "hunter2-secret"]]));
    s.remember("TOTP.totp", "123456");
    expect(s.redact("code 123456")).toBe("code [input:TOTP.totp]");
    const t = s.withTransient(["typed-but-unregistered", "abc"]);
    expect(t.redact("echo typed-but-unregistered and abc")).toBe("echo <filled> and abc");
    expect(t.redact("hunter2-secret")).toBe("[input:PASSWORD]");
    expect(s.redact("typed-but-unregistered")).toBe("typed-but-unregistered");
    expect(s.values().map(([n]) => n)).toEqual(["PASSWORD", "TOTP.totp"]);
  });
});
