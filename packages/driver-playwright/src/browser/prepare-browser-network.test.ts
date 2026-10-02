// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { SecretsRegistry } from "@ghosthand/core";
import type { BrowserNetworkInput } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { prepareBrowserNetwork } from "./prepare-browser-network.ts";

const startUrl = "https://app.example.com/account";
const solver = { enabled: true, origins: ["https://app.example.com"] };
const solution = () => ({
  status: "ok",
  solution: {
    url: startUrl,
    status: 200,
    userAgent: "test-browser-agent",
    cookies: [
      { name: "cf_clearance", value: "clearance-secret", domain: ".example.com", expires: -0.5 },
      { name: "foreign", value: "foreign-secret", domain: "other.example.com" },
      { name: "suffix", value: "suffix-secret", domain: "notexample.com" },
    ],
  },
});

function service(reply: (body: Record<string, unknown>) => unknown = solution) {
  const requests: Array<{ url: string; body: Record<string, unknown>; init: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ url: String(input), body, init });
    const value = reply(body);
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : Response.json(value);
  };
  return { fetch, requests };
}

describe("external browser network preparation", () => {
  it("never contacts the service when disabled or the starting origin is unlisted", async () => {
    const fake = service();
    expect(await prepareBrowserNetwork({ fetch: fake.fetch })).toEqual({ ok: true, value: { cookies: [] } });
    const result = await prepareBrowserNetwork({
      startUrl: "https://unlisted.example.com",
      network: { flaresolverr: solver },
      fetch: fake.fetch,
    });
    expect(result).toEqual({ ok: true, value: { cookies: [] } });
    expect(fake.requests).toHaveLength(0);
  });

  it("resolves ordinary proxy credentials without requiring FlareSolverr", async () => {
    const fake = service();
    const result = await prepareBrowserNetwork({
      network: {
        proxy: {
          enabled: true,
          server: "http://proxy.test:8080",
          usernameSecretRef: "USER",
          passwordSecretRef: "PASS",
        },
      },
      secrets: new SecretsRegistry([
        ["USER", "alice"],
        ["PASS", "proxy-password"],
      ]),
      fetch: fake.fetch,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        cookies: [],
        proxy: { server: "http://proxy.test:8080", username: "alice", password: "proxy-password" },
      },
    });
    expect(fake.requests).toHaveLength(0);
  });

  it.each(["http://127.0.0.1:4401/state", startUrl])(
    "refuses blocked target %s before external requests",
    async (url) => {
      const fake = service();
      const result = await prepareBrowserNetwork({
        startUrl: url,
        blockOrigins: ["app.example.com"],
        network: { flaresolverr: { ...solver, origins: [new URL(url).origin] } },
        fetch: fake.fetch,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { kind: "launch_failed", message: "FlareSolverr starting origin is blocked" },
      });
      expect(fake.requests).toHaveLength(0);
    },
  );

  it("prepares once with the shared proxy and bearer, filters cookies and does not send profile cookies", async () => {
    const fake = service();
    const result = await prepareBrowserNetwork({
      startUrl,
      network: {
        proxy: { enabled: true, server: "socks5://proxy.test:1080" },
        flaresolverr: {
          ...solver,
          endpoint: "https://solver.test/prefix/v1/",
          bearerSecretRef: "TOKEN",
          timeoutMs: 2000,
        },
      },
      secrets: new SecretsRegistry([["TOKEN", "bearer-secret"]]),
      fetch: fake.fetch,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        proxy: { server: "socks5://proxy.test:1080" },
        userAgent: "test-browser-agent",
        cookies: [
          { name: "cf_clearance", value: "clearance-secret", domain: ".example.com", path: "/", expires: -1 },
        ],
      },
    });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      url: "https://solver.test/prefix/v1",
      body: {
        cmd: "request.get",
        url: startUrl,
        maxTimeout: 2000,
        returnOnlyCookies: true,
        proxy: { url: "socks5://proxy.test:1080" },
      },
      init: { method: "POST", redirect: "error", headers: { Authorization: "Bearer bearer-secret" } },
    });
    expect(fake.requests[0]?.body).not.toHaveProperty("cookies");
  });

  it.each([
    {
      proxy: {
        enabled: true,
        server: "http://proxy.test",
        usernameSecretRef: "USER",
        passwordSecretRef: "PASS",
      },
    },
    { flaresolverr: { ...solver, bearerSecretRef: "TOKEN" } },
  ] satisfies BrowserNetworkInput[])(
    "fails missing named credentials before contacting a service",
    async (network) => {
      const fake = service();
      expect(await prepareBrowserNetwork({ startUrl, network, fetch: fake.fetch })).toMatchObject({
        ok: false,
        error: { kind: "launch_failed" },
      });
      expect(fake.requests).toHaveLength(0);
    },
  );

  it.each([
    { status: "error", message: "do not leak bearer-secret" },
    { status: "ok", solution: {} },
    { ...solution(), solution: { ...solution().solution, url: "https://foreign.test" } },
    { ...solution(), solution: { ...solution().solution, status: 403 } },
    new Response("bearer-secret", { status: 503 }),
    new Response("invalid bearer-secret json"),
    new Response("x".repeat(1024 * 1024 + 1)),
    new Error("bearer-secret transport failure"),
  ])("returns a sanitized error without retrying invalid or failed preparation %#", async (reply) => {
    const fake = service(() => reply);
    const result = await prepareBrowserNetwork({
      startUrl,
      network: { flaresolverr: solver },
      fetch: fake.fetch,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "launch_failed" } });
    expect(JSON.stringify(result)).not.toContain("bearer-secret");
    expect(fake.requests).toHaveLength(1);
  });

  it.each([false, true])(
    "owns and destroys only its authenticated-proxy session after request failure=%s",
    async (failed) => {
      const fake = service((body) => {
        if (body.cmd === "sessions.create") return { status: "ok", session: body.session };
        if (body.cmd === "sessions.destroy") return { status: "ok" };
        return failed ? { status: "error", message: "proxy-password" } : solution();
      });
      const result = await prepareBrowserNetwork({
        startUrl,
        network: {
          proxy: {
            enabled: true,
            server: "http://proxy.test:8080",
            usernameSecretRef: "USER",
            passwordSecretRef: "PASS",
          },
          flaresolverr: solver,
        },
        secrets: new SecretsRegistry([
          ["USER", "alice"],
          ["PASS", "proxy-password"],
        ]),
        fetch: fake.fetch,
      });
      expect(result.ok).toBe(!failed);
      expect(fake.requests.map((r) => r.body.cmd)).toEqual([
        "sessions.create",
        "request.get",
        "sessions.destroy",
      ]);
      const session = fake.requests[0]?.body.session;
      expect(session).toMatch(/^ghosthand-[\da-f-]+$/);
      expect(fake.requests[0]?.body.proxy).toEqual({
        url: "http://proxy.test:8080",
        username: "alice",
        password: "proxy-password",
      });
      expect(fake.requests[1]?.body.session).toBe(session);
      expect(fake.requests[1]?.body).not.toHaveProperty("proxy");
      expect(fake.requests[2]?.body).toEqual({ cmd: "sessions.destroy", session });
      if (failed) expect(JSON.stringify(result)).not.toContain("proxy-password");
    },
  );

  it.each(["creation", "cleanup"])("fails safely when session %s fails", async (stage) => {
    const fake = service((body) => {
      if (body.cmd === "sessions.create")
        return stage === "creation" ? new Error("proxy-password") : { status: "ok", session: body.session };
      if (body.cmd === "sessions.destroy")
        return stage === "cleanup" ? { status: "error" } : { status: "ok" };
      return solution();
    });
    const result = await prepareBrowserNetwork({
      startUrl,
      network: {
        proxy: {
          enabled: true,
          server: "http://proxy.test",
          usernameSecretRef: "USER",
          passwordSecretRef: "PASS",
        },
        flaresolverr: solver,
      },
      secrets: new SecretsRegistry([
        ["USER", "alice"],
        ["PASS", "proxy-password"],
      ]),
      fetch: fake.fetch,
    });
    expect(result.ok).toBe(false);
    expect(fake.requests.map((r) => r.body.cmd)).toEqual(
      stage === "creation"
        ? ["sessions.create", "sessions.destroy"]
        : ["sessions.create", "request.get", "sessions.destroy"],
    );
    expect(JSON.stringify(result)).not.toContain("proxy-password");
  });
});
