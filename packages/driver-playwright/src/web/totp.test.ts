// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { generateTotp } from "./totp.ts";

// RFC 6238 test key "12345678901234567890" in base32.
const RFC_KEY = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("generateTotp", () => {
  it("matches the RFC 6238 SHA1 vectors", () => {
    expect(generateTotp(RFC_KEY, { timestamp: 59_000, digits: 8 })).toEqual({ ok: true, value: "94287082" });
    expect(generateTotp(RFC_KEY, { timestamp: 1_111_111_109_000, digits: 8 })).toEqual({
      ok: true,
      value: "07081804",
    });
    expect(generateTotp(RFC_KEY, { timestamp: 59_000 })).toEqual({ ok: true, value: "287082" });
  });

  it("accepts otpauth URIs and lower-case secrets with spaces", () => {
    const uri = `otpauth://totp/GhostHand:ada?secret=${RFC_KEY}&digits=8&period=30`;
    expect(generateTotp(uri, { timestamp: 59_000 })).toEqual({ ok: true, value: "94287082" });
    const spaced = RFC_KEY.toLowerCase().replace(/(.{4})/g, "$1 ");
    expect(generateTotp(spaced, { timestamp: 59_000 })).toEqual({ ok: true, value: "287082" });
  });

  it("rejects invalid secrets without echoing them", () => {
    const r = generateTotp("not base32 !!!");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("not base32");
  });
});
