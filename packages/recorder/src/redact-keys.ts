// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Key-based redaction for JSON values written to the run folder.
//
// Keys are matched by suffix after lowercasing and dropping "_" and "-", against a closed list.
// A plain substring match on /token|secret/ would hit protocol fields that are not secrets:
// element refs (`token: "e12"`), secret *names* (`secrets: ["TESTBED_PASSWORD"]`) and
// `secretRef: "NAME"`. So `token`, `secrets` and `secretRef` are deliberately not matched,
// while `password`, `userPassword`, `api_key`, `accessToken`, `Set-Cookie`, `totp` are.
// Value-based redaction of registered secrets is the injected `redact` function's job.

export const REDACTED = "[redacted]";

const SENSITIVE_SUFFIXES = [
  "password",
  "passwd",
  "passphrase",
  "secret",
  "otp",
  "cookie",
  "cookies",
  "authorization",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "bearertoken",
  "authtoken",
  "privatekey",
] as const;

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_-]/g, "");
  return SENSITIVE_SUFFIXES.some((s) => k.endsWith(s));
}

/**
 * Returns a deep copy of `value` with string values of sensitive keys replaced by "[redacted]".
 * Only strings are replaced: numbers, booleans and nested structures under a sensitive key keep their
 * type (and nested strings are still checked), so redaction never breaks the event schema. For example a
 * choice option keyed after a secret name keeps its probability.
 */
export function redactKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redactKeys(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) && typeof v === "string" ? REDACTED : redactKeys(v);
    }
    return out;
  }
  return value;
}
