// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The Claude consultant against a fake `claude` CLI. No real process, no model calls.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { missingBinarySpawn } from "../codex/__fixtures__/fake-child-process.ts";
import { fakeClaude } from "./__fixtures__/fake-claude.ts";
import { claudeChildEnv, claudeStreamArgs, FORBIDDEN_CLAUDE_FLAGS } from "./claude-args.ts";
import { authKind, ClaudeConsultant } from "./claude-consultant.ts";
import type { ClaudeSession } from "./claude-session.ts";
import { parseClaudeEvent, resultError } from "./stream-events.ts";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ghosthand-claude-test-"));
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

function consultant(fake: ReturnType<typeof fakeClaude>, askTimeoutMs = 2000) {
  return new ClaudeConsultant({ spawn: fake.spawn, tmpRoot: dir, askTimeoutMs, env: { PATH: "/usr/bin" } });
}

async function openSession(c: ClaudeConsultant): Promise<ClaudeSession> {
  const s = await c.open({ system: "You plan.", model: "sonnet" });
  if (!s.ok) throw new Error(s.error.message);
  return s.value;
}

describe("claudeStreamArgs", () => {
  it("runs print mode with stream-json, no tools, dontAsk and no bypass or bare flags", () => {
    const args = claudeStreamArgs({ system: "sys", model: "opus", effort: "low", schema });
    expect(args.slice(0, 6)).toEqual([
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args[args.indexOf("--json-schema") + 1]).toBe(JSON.stringify(schema));
    expect(args[args.indexOf("--effort") + 1]).toBe("low");
    for (const flag of FORBIDDEN_CLAUDE_FLAGS) expect(args.join(" ")).not.toContain(flag);
  });

  it("drops a parent Claude Code session's variables but keeps user config", () => {
    const env = claudeChildEnv({
      CLAUDECODE: "1",
      CLAUDE_CODE_MESSAGING_SOCKET: "/run/x.sock",
      CLAUDE_CODE_SESSION_ID: "s",
      CLAUDE_CONFIG_DIR: "/home/u/.claude-work",
      ANTHROPIC_API_KEY: "sk-ant-user",
      PATH: "/bin",
    });
    expect(env).toEqual({
      CLAUDE_CONFIG_DIR: "/home/u/.claude-work",
      ANTHROPIC_API_KEY: "sk-ant-user",
      PATH: "/bin",
    });
  });
});

describe("ClaudeConsultant.probe", () => {
  it("reports version, subscription login and plan without keeping identity fields", async () => {
    const fake = fakeClaude();
    const probe = await consultant(fake).probeDetailed();
    expect(probe).toEqual({
      installed: true,
      version: "2.1.285",
      auth: "claude_ai",
      plan: "max",
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      models: ["fable", "opus", "sonnet", "haiku"],
    });
    expect(JSON.stringify(probe)).not.toContain("example.com");
    expect(fake.calls.map((c) => c.args.join(" "))).toEqual(["--version", "auth status --json"]);
  });

  it("reports a logged-out CLI with the login hint", async () => {
    const probe = await consultant(fakeClaude({ loggedIn: false })).probeDetailed();
    expect(probe).toMatchObject({ installed: true, auth: "none", error: { kind: "unauthenticated" } });
    expect(probe.error?.message).toContain("claude auth login");
  });

  it("reports a missing binary as not installed", async () => {
    const c = new ClaudeConsultant({ spawn: missingBinarySpawn(), tmpRoot: dir });
    expect(await c.probe()).toEqual({ installed: false, auth: "unknown", models: [] });
  });

  it("classifies auth methods", () => {
    expect(authKind({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" })).toBe(
      "claude_ai",
    );
    expect(authKind({ loggedIn: true, authMethod: "api_key" })).toBe("api_key");
    expect(authKind({ loggedIn: true, authMethod: "x", apiProvider: "bedrock" })).toBe("api_key");
    expect(authKind({ loggedIn: false })).toBe("none");
  });
});

describe("ClaudeSession", () => {
  it("refuses to open when the CLI is logged out", async () => {
    const r = await consultant(fakeClaude({ loggedIn: false })).open({ system: "s" });
    expect(!r.ok && r.error.kind).toBe("unauthenticated");
  });

  it("keeps one warm process per schema and returns structured_output", async () => {
    const fake = fakeClaude({
      turns: [
        { kind: "structured", value: { n: 1 } },
        { kind: "structured", value: { n: 2 } },
        { kind: "structured", value: { n: 3 } },
      ],
    });
    const session = await openSession(consultant(fake));
    expect(fake.printArgs).toHaveLength(0);
    const a = await session.ask({ prompt: "one", schema, parse });
    const b = await session.ask({ prompt: "two", schema, parse });
    expect(a.ok && a.value).toEqual({ n: 1 });
    expect(b.ok && b.value).toEqual({ n: 2 });
    expect(fake.printArgs).toHaveLength(1);
    const other = { ...schema, title: "other" };
    const c = await session.ask({ prompt: "three", schema: other, parse });
    expect(c.ok && c.value).toEqual({ n: 3 });
    expect(fake.printArgs).toHaveLength(2);
    expect(session.warmProcesses).toBe(2);
    expect(fake.userMessages[0]).toEqual({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "one" }] },
    });
    expect(session.lastStats).toMatchObject({
      durationMs: 1973,
      costUsd: 0.0021,
      model: "claude-haiku-4-5-20251001",
    });
    const printCall = fake.calls.find((call) => call.args[0] === "--print");
    expect(printCall?.cwd).toContain("ghosthand-claude-");
    await session.close();
  });

  it("sends screenshots as base64 image blocks", async () => {
    const shot = join(dir, "shot.png");
    await writeFile(shot, Buffer.from([137, 80, 78, 71]));
    const fake = fakeClaude({ turns: [{ kind: "structured", value: { n: 5 } }] });
    const session = await openSession(consultant(fake));
    const r = await session.ask({ prompt: "look", schema, parse, images: [shot] });
    expect(r.ok).toBe(true);
    const content = (fake.userMessages[0]?.message as { content: unknown[] } | undefined)?.content ?? [];
    expect(content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBORw==" },
    });
    await session.close();
  });

  it("falls back to parsing the result text when there is no structured output", async () => {
    const fake = fakeClaude({
      turns: [
        { kind: "text", text: '```json\n{"n": 7}\n```' },
        { kind: "text", text: "sorry" },
      ],
    });
    const session = await openSession(consultant(fake));
    expect(await session.ask({ prompt: "x", schema, parse })).toEqual({ ok: true, value: { n: 7 } });
    const bad = await session.ask({ prompt: "y", schema, parse });
    expect(!bad.ok && bad.error.kind).toBe("schema_failed");
    await session.close();
  });

  it("maps result errors: usage limits, auth and schema retries", async () => {
    const fake = fakeClaude({
      turns: [
        {
          kind: "error",
          subtype: "error_during_execution",
          result: "Claude AI usage limit reached|1790863200",
        },
        {
          kind: "error",
          subtype: "error_during_execution",
          result: "Invalid API key · Please run /login",
          apiErrorStatus: 401,
        },
        { kind: "error", subtype: "error_max_structured_output_retries", result: "gave up" },
      ],
    });
    const session = await openSession(consultant(fake));
    const kinds = [];
    for (const p of ["a", "b", "c"]) {
      const r = await session.ask({ prompt: p, schema, parse });
      kinds.push(r.ok ? "ok" : r.error.kind);
    }
    expect(kinds).toEqual(["usage_limit", "unauthenticated", "schema_failed"]);
    await session.close();
  });

  it("rejects structured output that fails the caller's parse", async () => {
    const fake = fakeClaude({ turns: [{ kind: "structured", value: { n: "nope" } }] });
    const session = await openSession(consultant(fake));
    const r = await session.ask({ prompt: "x", schema, parse });
    expect(!r.ok && r.error.kind).toBe("schema_failed");
    await session.close();
  });

  it("times out, kills the process and recovers with a fresh one", async () => {
    const fake = fakeClaude({ turns: [{ kind: "hang" }, { kind: "structured", value: { n: 9 } }] });
    const session = await openSession(consultant(fake));
    const r = await session.ask({ prompt: "x", schema, parse, timeoutMs: 30 });
    expect(r.ok ? undefined : r.error).toMatchObject({
      kind: "timeout",
      message: expect.stringContaining("Claude"),
    });
    expect(fake.children.find((c) => c.signalCode !== null)).toBeDefined();
    const again = await session.ask({ prompt: "y", schema, parse });
    expect(again.ok && again.value).toEqual({ n: 9 });
    expect(fake.printArgs).toHaveLength(2);
    await session.close();
  });

  it("cancels on the caller's signal and on interrupt", async () => {
    const fake = fakeClaude({ turns: [{ kind: "hang" }, { kind: "hang" }] });
    const session = await openSession(consultant(fake));
    const controller = new AbortController();
    const pending = session.ask({ prompt: "x", schema, parse, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    expect(await pending).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    const second = session.ask({ prompt: "y", schema, parse });
    setTimeout(() => void session.interrupt(), 10);
    expect(await second).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    await session.close();
  });

  it("surfaces a crashed process with its stderr", async () => {
    const fake = fakeClaude({ turns: [{ kind: "exit", stderr: "Error: not logged in. Please run /login" }] });
    const session = await openSession(consultant(fake));
    const r = await session.ask({ prompt: "x", schema, parse });
    expect(r.ok ? undefined : r.error).toMatchObject({ kind: "unauthenticated" });
    await session.close();
  });

  it("reports rate limits after a turn", async () => {
    const fake = fakeClaude({ turns: [{ kind: "structured", value: { n: 1 } }] });
    const session = await openSession(consultant(fake));
    expect((await session.rateLimits()).ok).toBe(false);
    await session.ask({ prompt: "x", schema, parse });
    expect(await session.rateLimits()).toEqual({
      ok: true,
      value: {
        primary: { usedPercent: 39, windowMinutes: 300, resetsAt: 1790863200 },
        secondary: { usedPercent: 18, windowMinutes: 10_080, resetsAt: 1791219600 },
      },
    });
    await session.close();
  });
});

describe("stream events", () => {
  it("parses a result line whose type key is not first", () => {
    const e = parseClaudeEvent(
      JSON.stringify({
        duration_api_ms: 1,
        is_error: false,
        subtype: "success",
        type: "result",
        structured_output: { a: 1 },
      }),
    );
    expect(e.kind).toBe("result");
    expect(parseClaudeEvent("not json").kind).toBe("other");
    expect(
      resultError({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        api_error_status: 429,
      }).kind,
    ).toBe("usage_limit");
  });
});
