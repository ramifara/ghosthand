// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FakeChild } from "./__fixtures__/fake-child-process.ts";
import { fakeSpawn, missingBinarySpawn } from "./__fixtures__/fake-child-process.ts";
import { CodexConsultant } from "./codex-consultant.ts";
import { execArgs, readExecEvent } from "./exec-session.ts";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ghosthand-codex-exec-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const schema = { type: "object", properties: { n: { type: "number" } }, required: ["n"] };
const parse = (v: unknown): { n: number } => {
  if (typeof v === "object" && v !== null && typeof Reflect.get(v, "n") === "number")
    return v as { n: number };
  throw new Error("n must be a number");
};

type ExecBehaviour =
  | { kind: "answer"; text: string }
  | { kind: "fail"; message: string }
  | { kind: "hang" }
  | { kind: "logged-out" };

function argAfter(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

/** Scripts `codex login status` and `codex exec --json`. */
function execScript(behaviour: ExecBehaviour) {
  const seen: { schema?: string; stdin?: string; args?: readonly string[] } = {};
  const fake = fakeSpawn((child: FakeChild, args) => {
    if (args[0] === "login") {
      setImmediate(() => {
        const out = behaviour.kind === "logged-out" ? "Not logged in\n" : "Logged in using ChatGPT\n";
        child.stdout.write(out);
        child.exit(behaviour.kind === "logged-out" ? 1 : 0);
      });
      return;
    }
    if (args[0] !== "exec") return;
    seen.args = args;
    child.stdin.on("finish", async () => {
      seen.stdin = child.stdinText.join("");
      seen.schema = await readFile(argAfter(args, "--output-schema") ?? "", "utf8");
      const send = (ev: unknown): void => {
        child.stdout.write(`${JSON.stringify(ev)}\n`);
      };
      send({ type: "thread.started", thread_id: "x" });
      send({ type: "turn.started" });
      if (behaviour.kind === "answer") {
        await writeFile(argAfter(args, "-o") ?? "", behaviour.text);
        send({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: behaviour.text } });
        send({ type: "turn.completed", usage: {} });
        child.exit(0);
      } else if (behaviour.kind === "fail") {
        send({ type: "error", message: "Reconnecting... 1/5" });
        send({ type: "turn.failed", error: { message: behaviour.message } });
        child.exit(1);
      }
    });
  });
  return { fake, seen };
}

describe("execArgs", () => {
  it("uses a read-only sandbox, output schema, images and no bypass flags", () => {
    const args = execArgs({
      cwd: "/tmp/w",
      schemaPath: "/tmp/w/s.json",
      outPath: "/tmp/w/o.txt",
      system: 'Be "brief".\nOnly JSON.',
      model: "gpt-a",
      effort: "low",
      images: ["/a.png", "/b.png"],
    });
    expect(args).toEqual([
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "-C",
      "/tmp/w",
      "--output-schema",
      "/tmp/w/s.json",
      "-o",
      "/tmp/w/o.txt",
      "--json",
      "-c",
      'developer_instructions="Be \\"brief\\".\\nOnly JSON."',
      "-m",
      "gpt-a",
      "-c",
      'model_reasoning_effort="low"',
      "-",
      "--image",
      "/a.png",
      "--image",
      "/b.png",
    ]);
    expect(args.join(" ")).not.toMatch(/dangerously|approve-for-me|full-access/);
  });

  it("reads exec JSONL events", () => {
    const events = {};
    readExecEvent(events, '{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}');
    readExecEvent(events, '{"type":"error","message":"Reconnecting"}');
    readExecEvent(events, '{"type":"turn.failed","error":{"message":"401 Unauthorized"}}');
    readExecEvent(events, "garbage");
    expect(events).toEqual({ agentText: "{}", lastError: "Reconnecting", failure: "401 Unauthorized" });
  });
});

describe("CodexConsultant with transport exec", () => {
  it("probes with --version and login status", async () => {
    const fake = fakeSpawn((child, args) => {
      setImmediate(() => {
        child.stdout.write(args[0] === "--version" ? "codex-cli 0.159.2\n" : "Logged in using ChatGPT\n");
        child.exit(0);
      });
    });
    const c = new CodexConsultant({ transport: "exec", spawn: fake.spawn, tmpRoot: dir });
    expect(await c.probe()).toEqual({ installed: true, version: "0.159.2", auth: "chatgpt", models: [] });
    const missing = new CodexConsultant({ transport: "exec", spawn: missingBinarySpawn(), tmpRoot: dir });
    expect((await missing.probe()).installed).toBe(false);
  });

  it("asks through codex exec and parses the last message", async () => {
    const { fake, seen } = execScript({ kind: "answer", text: '{"n":4}' });
    const c = new CodexConsultant({ transport: "exec", spawn: fake.spawn, tmpRoot: dir });
    const s = await c.open({ system: "sys" });
    if (!s.ok) throw new Error(s.error.message);
    const r = await s.value.ask({ prompt: "plan please", images: ["/x.png"], schema, parse });
    expect(r).toEqual({ ok: true, value: { n: 4 } });
    expect(seen.stdin).toBe("plan please");
    expect(JSON.parse(seen.schema ?? "")).toEqual(schema);
    expect(seen.args).toContain("--image");
    expect(await s.value.rateLimits()).toMatchObject({ ok: false, error: { kind: "process" } });
    await s.value.close();
  });

  it("maps failures, timeouts and signed-out state", async () => {
    const failing = execScript({ kind: "fail", message: "You've hit your usage limit" });
    const c1 = new CodexConsultant({ transport: "exec", spawn: failing.fake.spawn, tmpRoot: dir });
    const s1 = await c1.open({ system: "s" });
    if (!s1.ok) throw new Error(s1.error.message);
    expect(await s1.value.ask({ prompt: "p", schema, parse })).toMatchObject({
      ok: false,
      error: { kind: "usage_limit" },
    });
    await s1.value.close();

    const hanging = execScript({ kind: "hang" });
    const c2 = new CodexConsultant({ transport: "exec", spawn: hanging.fake.spawn, tmpRoot: dir });
    const s2 = await c2.open({ system: "s" });
    if (!s2.ok) throw new Error(s2.error.message);
    expect(await s2.value.ask({ prompt: "p", schema, parse, timeoutMs: 30 })).toMatchObject({
      ok: false,
      error: { kind: "timeout" },
    });
    const execChild = hanging.fake.children.at(-1);
    expect(execChild?.signalCode).toBe("SIGTERM");
    await s2.value.close();

    const out = execScript({ kind: "logged-out" });
    const c3 = new CodexConsultant({ transport: "exec", spawn: out.fake.spawn, tmpRoot: dir });
    expect(await c3.open({ system: "s" })).toMatchObject({ ok: false, error: { kind: "unauthenticated" } });
  });
});
