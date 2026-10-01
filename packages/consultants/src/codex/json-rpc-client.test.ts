// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { JsonRpcClient, LineDecoder, METHOD_NOT_FOUND } from "./json-rpc-client.ts";

function setup(options: ConstructorParameters<typeof JsonRpcClient>[1] = {}) {
  const fromServer = new PassThrough();
  const toServer = new PassThrough();
  const sent: Array<Record<string, unknown>> = [];
  const decoder = new LineDecoder();
  toServer.on("data", (chunk: Uint8Array) => {
    for (const line of decoder.push(chunk)) sent.push(JSON.parse(line) as Record<string, unknown>);
  });
  const client = new JsonRpcClient({ input: fromServer, output: toServer }, options);
  const serverSend = (msg: unknown): void => {
    fromServer.write(`${JSON.stringify(msg)}\n`);
  };
  return { client, fromServer, toServer, sent, serverSend };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe("LineDecoder", () => {
  it("splits on newlines across chunks and drops blank lines", () => {
    const d = new LineDecoder();
    expect(d.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(d.push(':2}\n\n{"c":3}\r\n')).toEqual(['{"b":2}', '{"c":3}']);
    expect(d.end()).toEqual([]);
  });

  it("reassembles a UTF-8 sequence split between chunks", () => {
    const d = new LineDecoder();
    const bytes = new TextEncoder().encode('{"t":"é✓"}\n');
    expect(d.push(bytes.slice(0, 8))).toEqual([]);
    expect(d.push(bytes.slice(8))).toEqual(['{"t":"é✓"}']);
  });

  it("flushes a final unterminated line on end", () => {
    const d = new LineDecoder();
    d.push('{"x":1}');
    expect(d.end()).toEqual(['{"x":1}']);
  });
});

describe("JsonRpcClient", () => {
  it("writes one JSON object per line without a jsonrpc member, like codex", async () => {
    const { client, sent } = setup();
    void client.request("initialize", { clientInfo: { name: "ghosthand" } });
    client.notify("initialized");
    await tick();
    expect(sent).toEqual([
      { id: 1, method: "initialize", params: { clientInfo: { name: "ghosthand" } } },
      { method: "initialized" },
    ]);
  });

  it("matches responses to requests by id, in any order", async () => {
    const { client, serverSend } = setup();
    const a = client.request("a");
    const b = client.request("b");
    serverSend({ id: 2, result: { which: "b" } });
    serverSend({ jsonrpc: "2.0", id: 1, result: { which: "a" } });
    expect(await a).toEqual({ ok: true, value: { which: "a" } });
    expect(await b).toEqual({ ok: true, value: { which: "b" } });
    expect(client.pendingCount).toBe(0);
  });

  it("handles several messages in one chunk and one message split over chunks", async () => {
    const { client, fromServer } = setup();
    const seen: string[] = [];
    client.onNotification((m) => seen.push(m));
    const r = client.request("x");
    fromServer.write('{"method":"n1"}\n{"method":"n2"}\n{"id":1,"res');
    fromServer.write('ult":7}\n');
    expect(await r).toEqual({ ok: true, value: 7 });
    expect(seen).toEqual(["n1", "n2"]);
  });

  it("returns JSON-RPC errors as rpc failures", async () => {
    const { client, serverSend } = setup();
    const r = client.request("account/rateLimits/read");
    serverSend({ id: 1, error: { code: -32600, message: "authentication required" } });
    expect(await r).toEqual({
      ok: false,
      error: {
        kind: "rpc",
        method: "account/rateLimits/read",
        code: -32600,
        message: "authentication required",
      },
    });
  });

  it("delivers notifications with params and supports unsubscribe", async () => {
    const { client, serverSend } = setup();
    const handler = vi.fn();
    const off = client.onNotification(handler);
    serverSend({ method: "turn/started", params: { threadId: "t" } });
    await tick();
    off();
    serverSend({ method: "turn/completed", params: {} });
    await tick();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("turn/started", { threadId: "t" });
  });

  it("answers server requests through onRequest", async () => {
    const { serverSend, sent } = setup({
      onRequest: (method) => ({ result: { decision: method === "approve/me" ? "decline" : "?" } }),
    });
    serverSend({ id: "s-1", method: "approve/me", params: {} });
    await tick();
    await tick();
    expect(sent).toEqual([{ id: "s-1", result: { decision: "decline" } }]);
  });

  it("answers server requests with method-not-found when there is no handler, or the handler throws", async () => {
    const { serverSend, sent } = setup();
    serverSend({ id: 5, method: "something", params: {} });
    await tick();
    expect(sent[0]).toMatchObject({ id: 5, error: { code: METHOD_NOT_FOUND } });

    const second = setup({
      onRequest: () => {
        throw new Error("boom");
      },
    });
    second.serverSend({ id: 6, method: "x" });
    await tick();
    await tick();
    expect(second.sent[0]).toMatchObject({ id: 6, error: { message: "boom" } });
  });

  it("times out a request and ignores the late response", async () => {
    vi.useFakeTimers();
    try {
      const { client, serverSend, fromServer } = setup({ onProtocolError: vi.fn() });
      const r = client.request("slow", undefined, { timeoutMs: 50 });
      vi.advanceTimersByTime(60);
      expect(await r).toMatchObject({ ok: false, error: { kind: "timeout", method: "slow" } });
      serverSend({ id: 1, result: 1 });
      fromServer.end();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a request through an AbortSignal", async () => {
    const { client } = setup();
    const ac = new AbortController();
    const r = client.request("long", undefined, { signal: ac.signal });
    ac.abort();
    expect(await r).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    const pre = await client.request("again", undefined, { signal: ac.signal });
    expect(pre).toMatchObject({ ok: false, error: { kind: "cancelled" } });
  });

  it("fails pending requests when the server closes its output, and refuses new ones", async () => {
    const { client, fromServer } = setup();
    const onClose = vi.fn();
    client.onClose(onClose);
    const r = client.request("x");
    fromServer.end();
    expect(await r).toMatchObject({ ok: false, error: { kind: "closed" } });
    expect(onClose).toHaveBeenCalledOnce();
    expect(client.closed).toBe(true);
    expect(await client.request("y")).toMatchObject({ ok: false, error: { kind: "closed" } });
    expect(client.notify("z")).toBe(false);
  });

  it("reports invalid lines and keeps going", async () => {
    const onProtocolError = vi.fn();
    const { client, fromServer } = setup({ onProtocolError });
    const r = client.request("x");
    fromServer.write('not json\n[1,2]\n{"id":99,"result":1}\n{"id":1,"result":"ok"}\n');
    expect(await r).toEqual({ ok: true, value: "ok" });
    expect(onProtocolError.mock.calls.map((c) => c[1])).toEqual([
      "invalid JSON",
      "not a JSON object",
      "response to an unknown request id",
    ]);
  });
});
