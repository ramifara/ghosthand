// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The stdio client against a tiny Node host (no native deps).
import { describe, expect, it } from "vitest";
import { spawnRpcHost } from "./rpc-client.ts";

const HOST = String.raw`
const rl = require("node:readline").createInterface({ input: process.stdin });
process.stdout.write("this line is not JSON\n");
process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "ready", params: {} }) + "\n");
rl.on("line", (line) => {
  const m = JSON.parse(line);
  const reply = (body) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, ...body }) + "\n");
  if (m.method === "hello") reply({ result: { protocolVersion: 1, host: { name: "node-fake", version: "1" },
    platform: "linux-x11", capabilities: { semanticActions: true, pointer: false, screenshots: false,
    recording: false, boundsTrust: "exact" }, screen: { width: 10, height: 10, scale: 1 } } });
  else if (m.method === "doctor") reply({ result: { checks: "not an array" } });
  else if (m.method === "act") reply({ error: { code: -32000, message: "gone", data: { kind: "stale_token" } } });
  else if (m.method === "wait_idle") {}
  else if (m.method === "close") { reply({ result: {} }); process.exit(0); }
  else reply({ error: { code: -32601, message: "unknown" } });
});
`;

const FATAL = String.raw`
process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "fatal", params: { kind: "launch_failed", message: "Xvfb is not installed" } }) + "\n");
setTimeout(() => process.exit(1), 50);
`;

describe("StdioRpcClient", () => {
  it("waits for ready, validates results, maps errors and times out", async () => {
    const spawned = await spawnRpcHost({ command: process.execPath, args: ["-e", HOST], callTimeoutMs: 300 });
    if (!spawned.ok) throw new Error(spawned.error.message);
    const c = spawned.value;
    const hello = await c.call("hello", { client: "t", protocolVersion: 1 });
    expect(hello.ok && hello.value.host.name).toBe("node-fake");
    const doctor = await c.call("doctor", {});
    expect(doctor).toMatchObject({ ok: false, error: { kind: "protocol" } });
    const act = await c.call("act", { snapshotId: "h1", ref: 1, op: "press" });
    expect(act).toMatchObject({ ok: false, error: { kind: "stale_token", message: "gone" } });
    const idle = await c.call("wait_idle", { capMs: 10 });
    expect(idle).toMatchObject({ ok: false, error: { kind: "timeout" } });
    await c.close();
    expect(c.closed).toBe(true);
    const after = await c.call("hello", { client: "t", protocolVersion: 1 });
    expect(after).toMatchObject({ ok: false, error: { kind: "closed" } });
  });

  it("reports a host's fatal start-up message", async () => {
    const r = await spawnRpcHost({ command: process.execPath, args: ["-e", FATAL] });
    expect(r).toMatchObject({
      ok: false,
      error: { kind: "launch_failed", message: "Xvfb is not installed" },
    });
  });

  it("reports a missing executable", async () => {
    const r = await spawnRpcHost({ command: "/nonexistent/ghosthand-host", args: [] });
    expect(r.ok).toBe(false);
  });
});
