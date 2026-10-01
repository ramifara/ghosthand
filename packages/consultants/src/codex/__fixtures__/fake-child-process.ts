// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Test doubles: a fake child process with piped stdio and a scriptable fake `codex app-server`.
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessLike, SpawnFn } from "../child-process.ts";
import { LineDecoder } from "../json-rpc-client.ts";

export type Message = Record<string, unknown>;

export class FakeChild extends EventEmitter implements ChildProcessLike {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly received: Message[] = [];
  readonly stdinText: string[] = [];
  onMessage: ((msg: Message, child: FakeChild) => void) | undefined;
  #lines = new LineDecoder();

  constructor() {
    super();
    this.stdin.on("data", (chunk: Uint8Array) => {
      this.stdinText.push(Buffer.from(chunk).toString("utf8"));
      for (const line of this.#lines.push(chunk)) {
        let msg: unknown;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof msg === "object" && msg !== null) {
          this.received.push(msg as Message);
          this.onMessage?.(msg as Message, this);
        }
      }
    });
  }

  send(msg: Message): void {
    this.stdout.write(`${JSON.stringify(msg)}\n`);
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.exit(null, signal);
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.stdout.end();
    this.emit("exit", code, signal);
  }

  requests(method: string): Message[] {
    return this.received.filter((m) => m.method === method && m.id !== undefined);
  }
}

export interface FakeSpawn {
  spawn: SpawnFn;
  children: FakeChild[];
  calls: Array<{ command: string; args: readonly string[]; cwd?: string }>;
}

/** Each spawned child is passed to `setup` (to install an `onMessage` script) and then emits `spawn`. */
export function fakeSpawn(setup: (child: FakeChild, args: readonly string[]) => void): FakeSpawn {
  const children: FakeChild[] = [];
  const calls: FakeSpawn["calls"] = [];
  const spawn: SpawnFn = (command, args, options) => {
    const child = new FakeChild();
    children.push(child);
    calls.push({ command, args, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) });
    setup(child, args);
    process.nextTick(() => child.emit("spawn"));
    return child;
  };
  return { spawn, children, calls };
}

export function missingBinarySpawn(): SpawnFn {
  return () => {
    const child = new FakeChild();
    const e = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
    process.nextTick(() => child.emit("error", e));
    return child;
  };
}

export type TurnScript =
  | { kind: "answer"; text: string; delayMs?: number }
  | { kind: "fail"; message: string; codexErrorInfo: unknown }
  | { kind: "hang" }
  | { kind: "approval-then-answer"; text: string }
  | { kind: "exit" };

export interface FakeAppServerOptions {
  signedIn?: boolean;
  plan?: string;
  turns?: TurnScript[];
  /** Ask turn/start to fail with a JSON-RPC error. */
  turnStartError?: { code: number; message: string };
}

export const THREAD_ID = "thread-1";

/** Scripts a minimal codex app-server that speaks the same JSON shapes as codex-cli 0.159.2. */
export function fakeAppServer(opts: FakeAppServerOptions = {}): (child: FakeChild) => void {
  const turns = [...(opts.turns ?? [])];
  let turnCounter = 0;
  return (child) => {
    // Shut down when the client ends stdin, like the real app-server.
    child.stdin.on("finish", () => setImmediate(() => child.exit(0)));
    const activeTurns = new Set<string>();
    const completeTurn = (turnId: string, status: string, items: Message[], error: Message | null): void => {
      if (!activeTurns.delete(turnId)) return;
      child.send({
        method: "turn/completed",
        params: { threadId: THREAD_ID, turn: { id: turnId, items, status, error, durationMs: 5 } },
      });
    };
    child.onMessage = (msg) => {
      const { id, method } = msg;
      if (id === undefined || typeof method !== "string") return;
      const reply = (result: unknown): void => child.send({ id, result });
      switch (method) {
        case "initialize":
          return reply({
            userAgent: "ghosthand/0.159.2 (Linux; x86_64) unknown (ghosthand; 0.0.0)",
            codexHome: "/home/u/.codex",
            platformFamily: "unix",
            platformOs: "linux",
          });
        case "account/read":
          return reply(
            opts.signedIn === false
              ? { account: null, requiresOpenaiAuth: true }
              : {
                  account: { type: "chatgpt", email: "someone@example.com", planType: opts.plan ?? "pro" },
                  requiresOpenaiAuth: true,
                },
          );
        case "model/list":
          return reply({
            data: [
              { id: "gpt-b", model: "gpt-b", hidden: false, isDefault: false },
              { id: "gpt-hidden", model: "gpt-hidden", hidden: true, isDefault: false },
              { id: "gpt-a", model: "gpt-a", hidden: false, isDefault: true },
            ],
            nextCursor: null,
          });
        case "account/rateLimits/read":
          if (opts.signedIn === false) {
            child.send({ id, error: { code: -32600, message: "codex account authentication required" } });
            return;
          }
          return reply({
            ordinaryUsageAllowed: true,
            rateLimits: {
              limitId: "codex",
              primary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1791047072 },
              secondary: null,
              planType: "pro",
              rateLimitReachedType: null,
            },
            accountId: "acct-should-not-be-kept",
          });
        case "thread/start":
          return reply({ thread: { id: THREAD_ID }, model: "gpt-a", reasoningEffort: "medium" });
        case "turn/interrupt": {
          const params = msg.params as { turnId: string };
          reply({});
          completeTurn(params.turnId, "interrupted", [], null);
          return;
        }
        case "turn/start": {
          if (opts.turnStartError) {
            child.send({ id, error: opts.turnStartError });
            return;
          }
          const turnId = `turn-${++turnCounter}`;
          activeTurns.add(turnId);
          // Like the real server, the first item notification may race the response.
          child.send({
            method: "item/completed",
            params: { threadId: THREAD_ID, turnId, item: { type: "userMessage", id: "u1", content: [] } },
          });
          reply({ turn: { id: turnId, items: [], status: "inProgress", error: null } });
          child.send({ method: "turn/started", params: { threadId: THREAD_ID, turn: { id: turnId } } });
          const script = turns.shift() ?? { kind: "answer", text: "{}" };
          const answer = (text: string): void => {
            const item = { type: "agentMessage", id: "m1", text, phase: "final_answer" };
            child.send({ method: "item/completed", params: { threadId: THREAD_ID, turnId, item } });
            completeTurn(turnId, "completed", [item], null);
          };
          if (script.kind === "answer") {
            setTimeout(() => answer(script.text), script.delayMs ?? 0);
          } else if (script.kind === "fail") {
            const error = { message: script.message, codexErrorInfo: script.codexErrorInfo };
            child.send({ method: "error", params: { error, willRetry: false, threadId: THREAD_ID, turnId } });
            completeTurn(turnId, "failed", [], error);
          } else if (script.kind === "approval-then-answer") {
            child.send({
              id: 900,
              method: "item/commandExecution/requestApproval",
              params: { threadId: THREAD_ID, turnId, itemId: "c1", command: "rm -rf /" },
            });
            setTimeout(() => answer(script.text), 5);
          } else if (script.kind === "exit") {
            setTimeout(() => child.exit(1), 1);
          }
          return;
        }
        default:
          child.send({ id, error: { code: -32601, message: `unknown method ${method}` } });
      }
    };
  };
}
