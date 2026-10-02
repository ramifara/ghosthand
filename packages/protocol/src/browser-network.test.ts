// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { BrowserNetwork } from "./browser-network.ts";

describe("BrowserNetwork", () => {
  it("defaults to no external network services", () => {
    const value = BrowserNetwork.parse({});
    expect(value.proxy.enabled).toBe(false);
    expect(value.flaresolverr.enabled).toBe(false);
  });
  it.each([
    "http://proxy.test:8080",
    "https://proxy.test:443",
    "socks4://proxy.test:1080",
    "socks5://proxy.test:1080",
  ])("accepts proxy %s", (server) => {
    expect(BrowserNetwork.safeParse({ proxy: { enabled: true, server } }).success).toBe(true);
  });
  it.each([
    "invalid",
    "socks5:///",
    "ftp://proxy.test",
    "http://user:password@proxy.test",
    "http://proxy.test/path",
    "http://proxy.test?password=secret",
    "http://proxy.test#secret",
  ])("rejects malformed or credential-bearing proxy %s without throwing", (server) => {
    expect(BrowserNetwork.safeParse({ proxy: { enabled: true, server } }).success).toBe(false);
  });
  it.each([
    { proxy: { enabled: true } },
    { proxy: { usernameSecretRef: "USER" } },
    { proxy: { server: "socks5://proxy.test:1080", usernameSecretRef: "USER", passwordSecretRef: "PASS" } },
    { flaresolverr: { enabled: true } },
    { flaresolverr: { endpoint: "http://user:password@solver.test" } },
    { flaresolverr: { endpoint: "invalid" } },
    { flaresolverr: { origins: ["https://app.test/path"] } },
    { flaresolverr: { timeoutMs: 999 } },
    { flaresolverr: { timeoutMs: 120001 } },
    { flaresolverr: { bearerSecretRef: "an actual password" } },
  ])("rejects incomplete or invalid service settings %#", (input) => {
    expect(BrowserNetwork.safeParse(input).success).toBe(false);
  });
});
