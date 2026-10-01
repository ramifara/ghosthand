// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { OriginGuard, parseOriginPattern } from "./origin-guard.ts";

describe("parseOriginPattern", () => {
  it("parses origins, host:port and wildcards", () => {
    expect(parseOriginPattern("https://app.test")).toEqual({
      scheme: "https:",
      host: "app.test",
      port: "443",
    });
    expect(parseOriginPattern("http://127.0.0.1:4400/login")).toEqual({
      scheme: "http:",
      host: "127.0.0.1",
      port: "4400",
    });
    expect(parseOriginPattern("localhost:4401")).toEqual({ host: "localhost", port: "4401" });
    expect(parseOriginPattern("*.example.com")).toEqual({ host: "*.example.com" });
    expect(parseOriginPattern("https://*.example.com")).toEqual({
      scheme: "https:",
      host: "*.example.com",
      port: "443",
    });
    expect(parseOriginPattern("not a url")).toBeUndefined();
  });
});

describe("OriginGuard", () => {
  const guard = new OriginGuard({
    allow: ["http://127.0.0.1:4400", "*.example.com", "http://127.0.0.1:4401"],
    block: ["https://prod.example.com"],
  });

  it("allows allowlisted top-level origins", () => {
    expect(guard.check("http://127.0.0.1:4400/profile").allowed).toBe(true);
    expect(guard.check("https://docs.example.com/x").allowed).toBe(true);
    expect(guard.check("https://example.com/").allowed).toBe(true);
    expect(guard.check("http://127.0.0.1:4500/").allowed).toBe(false);
    expect(guard.check("about:blank").allowed).toBe(true);
  });

  it("always blocks the testbed control API, even when allowlisted", () => {
    expect(guard.check("http://127.0.0.1:4401/reset")).toEqual({ allowed: false, reason: "blocklist" });
    expect(guard.checkRequest("http://localhost:4401/oracle/x", false)).toEqual({
      allowed: false,
      reason: "blocklist",
    });
    expect(guard.isBlocked("ws://127.0.0.1:4401/socket")).toBe(true);
  });

  it("lets the blocklist win over a wildcard allow", () => {
    expect(guard.check("https://prod.example.com/")).toEqual({ allowed: false, reason: "blocklist" });
  });

  it("allows subresources from other origins unless strict", () => {
    expect(guard.checkRequest("https://cdn.other.test/app.js", false).allowed).toBe(true);
    expect(guard.checkRequest("https://cdn.other.test/", true).allowed).toBe(false);
    const strict = new OriginGuard({ allow: ["http://127.0.0.1:4400"], strictSubresources: true });
    expect(strict.checkRequest("https://cdn.other.test/app.js", false).allowed).toBe(false);
  });

  it("treats an empty allowlist as open, except the blocklist", () => {
    const open = new OriginGuard();
    expect(open.hasAllowlist).toBe(false);
    expect(open.check("https://anything.test/").allowed).toBe(true);
    expect(open.check("http://localhost:4401/").allowed).toBe(false);
    expect(open.check("chrome-error://chromewebdata/").allowed).toBe(true);
    const closed = new OriginGuard({ allow: ["https://app.test"] });
    expect(closed.check("chrome-error://chromewebdata/").allowed).toBe(false);
  });
});
