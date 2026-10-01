// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A scriptable fake `claude` CLI on top of the fake child process: `--version`, `auth status --json`
// and `--print` stream-json turns, with the event shapes Claude Code 2.1.285 emits.
import type { FakeChild, FakeSpawn, Message } from "../../codex/__fixtures__/fake-child-process.ts";
import { fakeSpawn } from "../../codex/__fixtures__/fake-child-process.ts";

export type ClaudeTurn =
  | { kind: "structured"; value: unknown; delayMs?: number }
  | { kind: "text"; text: string }
  | { kind: "error"; subtype: string; result: string; apiErrorStatus?: number }
  | { kind: "hang" }
  | { kind: "exit"; stderr: string };

export interface FakeClaudeOptions {
  loggedIn?: boolean;
  authMethod?: string;
  subscriptionType?: string;
  /** Turns served in order across all `--print` processes. */
  turns?: ClaudeTurn[];
}

export interface FakeClaude extends FakeSpawn {
  /** User messages received by `--print` processes, in order. */
  readonly userMessages: Message[];
  /** argv of each `--print` process. */
  readonly printArgs: Array<readonly string[]>;
}

export function fakeClaude(opts: FakeClaudeOptions = {}): FakeClaude {
  const turns = [...(opts.turns ?? [])];
  const userMessages: Message[] = [];
  const printArgs: Array<readonly string[]> = [];
  const finish = (child: FakeChild, stdout: string, code: number): void => {
    setImmediate(() => {
      child.stdout.write(stdout);
      child.exit(code);
    });
  };
  const fake = fakeSpawn((child, args) => {
    if (args[0] === "--version") return finish(child, "2.1.285 (Claude Code)\n", 0);
    if (args[0] === "auth") {
      const loggedIn = opts.loggedIn ?? true;
      const status = loggedIn
        ? {
            loggedIn: true,
            authMethod: opts.authMethod ?? "claude.ai",
            apiProvider: "firstParty",
            email: "someone@example.com",
            orgId: "org-should-not-be-kept",
            subscriptionType: opts.subscriptionType ?? "max",
          }
        : { loggedIn: false };
      return finish(child, `${JSON.stringify(status, null, 2)}\n`, loggedIn ? 0 : 1);
    }
    if (args[0] !== "--print") return finish(child, "", 2);
    printArgs.push(args);
    child.stdin.on("finish", () => setImmediate(() => child.exit(0)));
    let initSent = false;
    child.onMessage = (msg) => {
      if (msg.type !== "user") return;
      userMessages.push(msg);
      if (!initSent) {
        initSent = true;
        child.send({
          type: "system",
          subtype: "init",
          model: "claude-haiku-4-5-20251001",
          tools: ["StructuredOutput"],
          claude_code_version: "2.1.285",
          permissionMode: "dontAsk",
        });
      }
      child.send({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed",
          resetsAt: 1790863200,
          rateLimitType: "five_hour",
          unifiedWindows: {
            five_hour: { utilization: 0.39, resetsAt: 1790863200 },
            seven_day: { utilization: 0.18, resetsAt: 1791219600 },
          },
        },
      });
      const turn = turns.shift() ?? { kind: "structured", value: {} };
      const result = (extra: Record<string, unknown>) =>
        child.send({
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 1973,
          total_cost_usd: 0.0021,
          ...extra,
        });
      switch (turn.kind) {
        case "structured":
          setTimeout(
            () => result({ result: JSON.stringify(turn.value), structured_output: turn.value }),
            turn.delayMs ?? 0,
          );
          return;
        case "text":
          result({ result: turn.text });
          return;
        case "error":
          result({
            subtype: turn.subtype,
            is_error: true,
            result: turn.result,
            api_error_status: turn.apiErrorStatus ?? null,
          });
          return;
        case "exit":
          child.stderr.write(turn.stderr);
          setImmediate(() => child.exit(1));
          return;
        case "hang":
          return;
      }
    };
  });
  return { ...fake, userMessages, printArgs };
}
