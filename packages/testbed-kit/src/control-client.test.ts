// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { createControlClient } from "./control-client.ts";
import { l1UpdateProfile } from "./tasks/l1-update-profile.ts";

type Call = { url: string; method: string; body: unknown };

function fakeFetch(responses: Record<string, { status?: number; json: unknown }>, calls: Call[]) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${new URL(url).pathname}`;
    const r = responses[key];
    if (!r) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  };
}

describe("createControlClient", () => {
  it("parses oracle results and passes the answer as a query parameter", async () => {
    const calls: Call[] = [];
    const client = createControlClient({
      baseUrl: "http://control.test/",
      fetch: fakeFetch({ "GET /oracle/l1-login": { json: { pass: true, checks: { a: true } } } }, calls),
    });
    const res = await client.oracle("l1-login", { answer: "x y" });
    expect(res).toEqual({ ok: true, value: { pass: true, checks: { a: true } } });
    expect(calls[0]?.url).toBe("http://control.test/oracle/l1-login?answer=x%20y");
  });

  it("returns typed errors for HTTP failures, bad JSON and schema mismatches", async () => {
    const client = createControlClient({
      baseUrl: "http://control.test",
      fetch: fakeFetch({ "GET /mail": { json: { wrong: true } } }, []),
    });
    expect((await client.oracle("missing")).ok).toBe(false);
    const http = await client.oracle("missing");
    expect(!http.ok && http.error.kind).toBe("http");
    const bad = await client.mail();
    expect(!bad.ok && bad.error.kind).toBe("invalid_response");
  });

  it("reports network errors", async () => {
    const client = createControlClient({
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const res = await client.reset();
    expect(res).toEqual({ ok: false, error: { kind: "network", message: "ECONNREFUSED" } });
  });

  it("prepare resets with the task seed and variant, then signs in", async () => {
    const calls: Call[] = [];
    const client = createControlClient({
      baseUrl: "http://control.test",
      fetch: fakeFetch(
        {
          "POST /reset": { json: { seed: 42, variant: { testids: "off", a11y: "good" }, resetId: 1 } },
          "POST /session": { json: { cookie: { name: "gh_session", value: "abc" } } },
        },
        calls,
      ),
    });
    const res = await client.prepare(l1UpdateProfile);
    expect(res.ok && res.value.cookie).toEqual({ name: "gh_session", value: "abc" });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "POST /reset",
      "POST /session",
    ]);
    expect(calls[0]?.body).toEqual({ seed: 42, variant: { testids: "off", a11y: "good" } });
    expect(calls[1]?.body).toEqual({ email: "alice@testbed.local" });
  });
});
