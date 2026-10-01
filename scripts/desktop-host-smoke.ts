// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Smoke test for a native desktop host binary (Windows UIA, macOS AX), Node built-ins only so CI needs no
// install. Always checks hello + doctor; with --app it also launches the app, observes, types into the first
// editable text field and reads the value back. It acts on the real desktop: run it on a CI runner or a VM.
//   node scripts/desktop-host-smoke.ts --host <path> [--app notepad] [--strict] [-- host args...]
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  options: { host: { type: "string" }, app: { type: "string" }, strict: { type: "boolean" } },
  allowPositionals: true,
});
if (!values.host) {
  console.error("usage: node scripts/desktop-host-smoke.ts --host <binary> [--app <command>] [--strict]");
  process.exit(2);
}

type Msg = {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message: string; data?: { kind?: string } };
};
const child = spawn(values.host, positionals, { stdio: ["pipe", "pipe", "inherit"] });
const waiting = new Map<number, (m: Msg) => void>();
let ready: (m: Msg) => void = () => {};
const readyP = new Promise<Msg>((r) => {
  ready = r;
});
createInterface({ input: child.stdout }).on("line", (line) => {
  let m: Msg;
  try {
    m = JSON.parse(line) as Msg;
  } catch {
    console.error(`non-JSON line: ${line.slice(0, 120)}`);
    return;
  }
  if (m.method === "ready" || m.method === "fatal") ready(m);
  else if (m.id !== undefined) waiting.get(m.id)?.(m);
});
let next = 1;
function call(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<Msg> {
  const id = next++;
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ id, error: { message: `${method} timed out` } }), timeoutMs);
    waiting.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

const report: Record<string, string> = {};
let failed = false;
const step = (name: string, ok: boolean, detail: string, required: boolean) => {
  report[name] = `${ok ? "ok" : "FAIL"}: ${detail}`;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(10)} ${detail}`);
  if (!ok && required) failed = true;
};

const first = await Promise.race([
  readyP,
  new Promise<Msg>((r) => setTimeout(() => r({ method: "timeout" }), 30_000)),
]);
step("start", first.method === "ready", String(first.method), true);
if (first.method !== "ready") process.exit(1);

const hello = await call("hello", { client: "smoke", protocolVersion: 1 });
step("hello", hello.result !== undefined, JSON.stringify(hello.result ?? hello.error).slice(0, 300), true);
const doctor = await call("doctor");
step(
  "doctor",
  doctor.result !== undefined,
  JSON.stringify(doctor.result ?? doctor.error).slice(0, 600),
  true,
);
const strict = values.strict ?? false;

if (values.app) {
  const launch = await call("launch", { argv: values.app.split(" "), waitMs: 30_000 });
  step("launch", launch.result !== undefined, JSON.stringify(launch.result ?? launch.error), strict);
  if (launch.result !== undefined) {
    type Node = { ref: number; role: string; name: string; states: string[]; value?: string };
    const obs = await call("observe");
    const snap = obs.result as { snapshotId: string; nodes: Node[] } | undefined;
    step(
      "observe",
      snap !== undefined,
      snap ? `${snap.nodes.length} nodes` : JSON.stringify(obs.error),
      strict,
    );
    const field = snap?.nodes.find(
      (n) =>
        n.states.includes("editable") &&
        ["Edit", "Document", "AXTextArea", "AXTextField", "entry", "text"].includes(n.role),
    );
    if (snap && field) {
      const act = await call("act", {
        snapshotId: snap.snapshotId,
        ref: field.ref,
        op: "set_value",
        value: "ghosthand smoke",
      });
      const r = act.result as { ok: boolean; nativeRoute: string; after?: { value?: string } } | undefined;
      step(
        "set_value",
        r?.after?.value?.includes("ghosthand smoke") ?? false,
        r ? `${r.nativeRoute} → ${JSON.stringify(r.after?.value)}` : JSON.stringify(act.error),
        strict,
      );
    } else step("set_value", false, "no editable text field found", strict);
    const shot = await call("screenshot");
    const s = shot.result as { width: number; height: number } | undefined;
    step("screenshot", s !== undefined, s ? `${s.width}x${s.height}` : JSON.stringify(shot.error), false);
  }
}
await call("close", {}, 10_000);
child.stdin.end();
console.log(JSON.stringify(report));
process.exit(failed ? 1 : 0);
