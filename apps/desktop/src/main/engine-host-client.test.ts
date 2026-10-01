// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { EngineHostClient, type HostProcess } from "./engine-host-client.ts";

class FakeHost implements HostProcess {
  readonly sent: Array<{ message: unknown; transfer?: unknown[] }> = [];
  #message: Array<(m: unknown) => void> = [];
  #exit: Array<(code: number) => void> = [];
  killed = false;
  postMessage(message: unknown, transfer?: unknown[]): void {
    this.sent.push({ message, ...(transfer ? { transfer } : {}) });
  }
  on(event: "message" | "exit", listener: ((m: unknown) => void) & ((code: number) => void)): this {
    if (event === "message") this.#message.push(listener);
    else this.#exit.push(listener);
    return this;
  }
  kill(): boolean {
    this.killed = true;
    return true;
  }
  emit(m: unknown): void {
    for (const l of this.#message) l(m);
  }
  exit(code: number): void {
    for (const l of this.#exit) l(code);
  }
}

function setup(maxRestarts = 3) {
  const hosts: FakeHost[] = [];
  const notices: unknown[] = [];
  let ready = 0;
  const client = new EngineHostClient({
    spawn: () => {
      const h = new FakeHost();
      hosts.push(h);
      return h;
    },
    onNotice: (n) => notices.push(n),
    onReady: () => ready++,
    maxRestarts,
  });
  client.start();
  return { client, hosts, notices, ready: () => ready };
}

describe("EngineHostClient", () => {
  it("correlates responses by id and attaches settings/credentials", async () => {
    const { client, hosts } = setup();
    const p = client.request("runs.list", { limit: 5 }, { credentials: { secrets: { A_KEY: "x" } } });
    const sent = hosts[0]?.sent[0]?.message as { id: number; command: string; credentials: unknown };
    expect(sent.command).toBe("runs.list");
    expect(sent.credentials).toEqual({ secrets: { A_KEY: "x" } });
    hosts[0]?.emit({ kind: "response", id: sent.id + 99, ok: true, value: "ignored" });
    hosts[0]?.emit({ kind: "response", id: sent.id, ok: true, value: [1, 2] });
    expect(await p).toEqual({ ok: true, value: [1, 2] });
  });

  it("times out a silent host", async () => {
    const { client } = setup();
    const r = await client.request("doctor.run", {}, { timeoutMs: 10 });
    expect(r).toEqual({ ok: false, error: { kind: "engine", message: "doctor.run timed out" } });
  });

  it("fails pending requests on exit and restarts a bounded number of times", async () => {
    const { client, hosts } = setup(1);
    const p = client.request("tasks.list", {});
    hosts[0]?.exit(9);
    expect(await p).toMatchObject({ ok: false, error: { kind: "engine" } });
    expect(hosts).toHaveLength(2);
    hosts[1]?.exit(9);
    expect(hosts).toHaveLength(2);
    expect(client.running).toBe(false);
    expect(await client.request("tasks.list", {})).toMatchObject({
      ok: false,
      error: { kind: "unavailable" },
    });
  });

  it("passes notices and ready, and hands over ports", () => {
    const { client, hosts, notices, ready } = setup();
    hosts[0]?.emit({ kind: "ready" });
    hosts[0]?.emit({ kind: "run.status", runId: "r1", status: "paused" });
    hosts[0]?.emit({ kind: "garbage" });
    expect(ready()).toBe(1);
    expect(notices).toEqual([{ kind: "ready" }, { kind: "run.status", runId: "r1", status: "paused" }]);
    const port = { fake: true };
    client.sendPort(port);
    expect(hosts[0]?.sent.at(-1)).toEqual({ message: { kind: "port" }, transfer: [port] });
  });

  it("stop kills without restarting", () => {
    const { client, hosts } = setup();
    client.stop();
    hosts[0]?.exit(0);
    expect(hosts[0]?.killed).toBe(true);
    expect(hosts).toHaveLength(1);
  });
});
