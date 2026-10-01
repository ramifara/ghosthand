// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FakeAppServerOptions, FakeChild } from "./__fixtures__/fake-child-process.ts";
import {
  fakeAppServer,
  fakeSpawn,
  missingBinarySpawn,
  THREAD_ID,
} from "./__fixtures__/fake-child-process.ts";
import { CodexConsultant } from "./codex-consultant.ts";

let dir: string;
let image: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ghosthand-codex-test-"));
  image = join(dir, "shot.png");
  await writeFile(image, "not really a png");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const schema = {
  type: "object",
  properties: { n: { type: "number" } },
  required: ["n"],
  additionalProperties: false,
};
const parse = (v: unknown): { n: number } => {
  if (typeof v === "object" && v !== null && typeof Reflect.get(v, "n") === "number")
    return v as { n: number };
  throw new Error("n must be a number");
};

function consultant(opts: FakeAppServerOptions = {}) {
  const fake = fakeSpawn(fakeAppServer(opts));
  const c = new CodexConsultant({
    spawn: fake.spawn,
    binary: "/opt/codex",
    tmpRoot: dir,
    askTimeoutMs: 2000,
  });
  return { c, fake };
}

async function openSession(opts: FakeAppServerOptions = {}) {
  const { c, fake } = consultant(opts);
  const s = await c.open({ system: "You plan.", model: "gpt-a" });
  if (!s.ok) throw new Error(`open failed: ${s.error.message}`);
  const child = fake.children[0] as FakeChild;
  return { session: s.value, child, fake };
}

describe("CodexConsultant.probe (app-server)", () => {
  it("reports version, auth, plan and visible models with the default first", async () => {
    const { c, fake } = consultant();
    expect(await c.probe()).toEqual({
      installed: true,
      version: "0.159.2",
      auth: "chatgpt",
      plan: "pro",
      models: ["gpt-a", "gpt-b"],
    });
    expect(fake.calls[0]).toMatchObject({ command: "/opt/codex", args: ["app-server"] });
    const child = fake.children[0] as FakeChild;
    expect(child.requests("initialize")[0]).toMatchObject({
      params: { clientInfo: { name: "ghosthand" }, capabilities: { experimentalApi: false } },
    });
    expect(child.received.some((m) => m.method === "initialized" && m.id === undefined)).toBe(true);
    expect(child.exitCode).toBe(0);
  });

  it("includes rate limits on request and never keeps the email or account id", async () => {
    const { c } = consultant();
    const p = await c.probeDetailed({ rateLimits: true });
    expect(p.rateLimits).toEqual({
      limits: { primary: { usedPercent: 40, windowMinutes: 10080, resetsAt: 1791047072 } },
      planType: "pro",
      ordinaryUsageAllowed: true,
    });
    expect(JSON.stringify(p)).not.toMatch(/example\.com|acct-should-not-be-kept/);
  });

  it("reports not installed when the binary is missing", async () => {
    const c = new CodexConsultant({ spawn: missingBinarySpawn(), tmpRoot: dir });
    expect(await c.probe()).toEqual({ installed: false, auth: "unknown", models: [] });
    expect((await c.probeDetailed()).error?.kind).toBe("not_installed");
  });

  it("reports auth none when signed out", async () => {
    const { c } = consultant({ signedIn: false });
    const p = await c.probeDetailed();
    expect(p).toMatchObject({
      installed: true,
      auth: "none",
      models: [],
      error: { kind: "unauthenticated" },
    });
  });
});

describe("CodexConsultant.open (app-server)", () => {
  it("returns not_installed and unauthenticated as errors", async () => {
    const missing = new CodexConsultant({ spawn: missingBinarySpawn(), tmpRoot: dir });
    expect(await missing.open({ system: "s" })).toMatchObject({
      ok: false,
      error: { kind: "not_installed" },
    });
    const { c, fake } = consultant({ signedIn: false });
    expect(await c.open({ system: "s" })).toMatchObject({ ok: false, error: { kind: "unauthenticated" } });
    expect(fake.children[0]?.exitCode).toBe(0);
  });

  it("starts an ephemeral read-only thread that never asks for approval", async () => {
    const { session, child, fake } = await openSession();
    expect(child.requests("thread/start")[0]?.params).toMatchObject({
      ephemeral: true,
      sandbox: "read-only",
      approvalPolicy: "never",
      developerInstructions: "You plan.",
      model: "gpt-a",
    });
    expect(fake.calls[0]?.cwd).toMatch(/ghosthand-codex-/);
    await session.close();
  });
});

describe("CodexAppServerSession.ask", () => {
  it("sends text, localImage and outputSchema and returns the parsed final message", async () => {
    const { session, child } = await openSession({ turns: [{ kind: "answer", text: '{"n":3}' }] });
    const r = await session.ask({ prompt: "plan it", images: [image], schema, parse, effort: "low" });
    expect(r).toEqual({ ok: true, value: { n: 3 } });
    expect(child.requests("turn/start")[0]?.params).toEqual({
      threadId: THREAD_ID,
      input: [
        { type: "text", text: "plan it", text_elements: [] },
        { type: "localImage", path: image },
      ],
      outputSchema: schema,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      effort: "low",
    });
    await session.close();
    expect(child.exitCode).toBe(0);
  });

  it("serializes concurrent asks on one thread", async () => {
    const { session } = await openSession({
      turns: [
        { kind: "answer", text: '{"n":1}', delayMs: 20 },
        { kind: "answer", text: '{"n":2}' },
      ],
    });
    const [a, b] = await Promise.all([
      session.ask({ prompt: "1", schema, parse }),
      session.ask({ prompt: "2", schema, parse }),
    ]);
    expect(a).toEqual({ ok: true, value: { n: 1 } });
    expect(b).toEqual({ ok: true, value: { n: 2 } });
    await session.close();
  });

  it("returns schema_failed when the answer is not valid", async () => {
    const { session } = await openSession({
      turns: [
        { kind: "answer", text: "I think the plan is..." },
        { kind: "answer", text: '{"n":"three"}' },
      ],
    });
    expect(await session.ask({ prompt: "p", schema, parse })).toMatchObject({
      ok: false,
      error: { kind: "schema_failed" },
    });
    expect(await session.ask({ prompt: "p", schema, parse })).toMatchObject({
      ok: false,
      error: { kind: "schema_failed" },
    });
    await session.close();
  });

  it("maps a failed turn with usageLimitExceeded to usage_limit", async () => {
    const { session } = await openSession({
      turns: [
        { kind: "fail", message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded" },
      ],
    });
    expect(await session.ask({ prompt: "p", schema, parse })).toMatchObject({
      ok: false,
      error: { kind: "usage_limit" },
    });
    await session.close();
  });

  it("maps a failed turn with unauthorized to unauthenticated", async () => {
    const { session } = await openSession({
      turns: [{ kind: "fail", message: "401", codexErrorInfo: "unauthorized" }],
    });
    expect(await session.ask({ prompt: "p", schema, parse })).toMatchObject({
      ok: false,
      error: { kind: "unauthenticated" },
    });
    await session.close();
  });

  it("times out, sends turn/interrupt and stays usable", async () => {
    const { session, child } = await openSession({
      turns: [{ kind: "hang" }, { kind: "answer", text: '{"n":9}' }],
    });
    const r = await session.ask({ prompt: "p", schema, parse, timeoutMs: 30 });
    expect(r).toMatchObject({ ok: false, error: { kind: "timeout" } });
    expect(child.requests("turn/interrupt")[0]?.params).toEqual({ threadId: THREAD_ID, turnId: "turn-1" });
    expect(await session.ask({ prompt: "again", schema, parse })).toEqual({ ok: true, value: { n: 9 } });
    await session.close();
  });

  it("cancels through an AbortSignal and interrupts the turn", async () => {
    const { session, child } = await openSession({ turns: [{ kind: "hang" }] });
    const ac = new AbortController();
    const pending = session.ask({ prompt: "p", schema, parse, signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    expect(await pending).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    expect(child.requests("turn/interrupt")).toHaveLength(1);
    const pre = await session.ask({ prompt: "p", schema, parse, signal: AbortSignal.abort() });
    expect(pre).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    await session.close();
  });

  it("interrupt() stops the running turn", async () => {
    const { session, child } = await openSession({ turns: [{ kind: "hang" }] });
    const pending = session.ask({ prompt: "p", schema, parse });
    setTimeout(() => void session.interrupt(), 20);
    expect(await pending).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    expect(child.requests("turn/interrupt")).toHaveLength(1);
    await session.close();
  });

  it("declines approval requests from the server and still answers", async () => {
    const { session, child } = await openSession({
      turns: [{ kind: "approval-then-answer", text: '{"n":5}' }],
    });
    expect(await session.ask({ prompt: "p", schema, parse })).toEqual({ ok: true, value: { n: 5 } });
    expect(child.received.find((m) => m.id === 900)).toEqual({ id: 900, result: { decision: "decline" } });
    await session.close();
  });

  it("returns a process error when app-server exits mid-turn", async () => {
    const { session } = await openSession({ turns: [{ kind: "exit" }] });
    expect(await session.ask({ prompt: "p", schema, parse })).toMatchObject({
      ok: false,
      error: { kind: "process", message: expect.stringContaining("exited") },
    });
    expect(await session.ask({ prompt: "p", schema, parse })).toMatchObject({
      ok: false,
      error: { kind: "process" },
    });
    await session.close();
  });

  it("returns a process error for a missing image and for turn/start errors", async () => {
    const { session } = await openSession({ turnStartError: { code: -32602, message: "bad outputSchema" } });
    expect(await session.ask({ prompt: "p", images: [join(dir, "nope.png")], schema, parse })).toMatchObject({
      ok: false,
      error: { kind: "process", message: expect.stringContaining("image not found") },
    });
    expect(await session.ask({ prompt: "p", schema, parse })).toMatchObject({
      ok: false,
      error: { kind: "process", message: expect.stringContaining("bad outputSchema") },
    });
    await session.close();
  });

  it("reads rate limits", async () => {
    const { session } = await openSession();
    expect(await session.rateLimits()).toEqual({
      ok: true,
      value: { primary: { usedPercent: 40, windowMinutes: 10080, resetsAt: 1791047072 } },
    });
    await session.close();
  });
});
