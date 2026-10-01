// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// AgentConsultant over the user's own, unmodified `claude` CLI (Claude Code). Policy (docs/research/
// notes/cli-agents.md §2, license.md §4, ADR 0007):
// - GhostHand spawns the binary the user installed and signed in to with `claude auth login` (or
//   configured with their own API key). It never reads, stores or forwards Claude credentials or
//   OAuth tokens, never reads `~/.claude`, offers no "Sign in with Claude", and does not use the
//   proprietary Agent SDK.
// - Auth is checked with `claude auth status`, and only `loggedIn`, `authMethod`, `apiProvider` and
//   `subscriptionType` are kept (not the email or organisation).
// - It is opt-in and called rarely (planning), never per step. Anthropic's terms for subscription use
//   by third-party tools can change without notice; an Anthropic API key is the recommended path.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConsultant, ConsultantError, ConsultantProbe, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import { z } from "zod";
import type { SpawnFn } from "../codex/child-process.ts";
import { collectTail, defaultSpawn, startProcess } from "../codex/child-process.ts";
import { claudeChildEnv } from "./claude-args.ts";
import { ClaudeSession } from "./claude-session.ts";

export interface ClaudeConsultantOptions {
  /** Path or name of the CLI. Default `claude` (resolved on PATH). */
  binary?: string;
  /** Base environment; nested-session variables are removed. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnFn;
  /** Timeout for `--version` and `auth status`. Default 15 s. */
  requestTimeoutMs?: number;
  /** Default timeout per ask. Default 180 s. */
  askTimeoutMs?: number;
  /** Parent for the session's private working directory. Default the OS temp dir. */
  tmpRoot?: string;
}

/** The parts of `claude auth status` we keep. Identity fields (email, org) are dropped. */
export const ClaudeAuthStatus = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  apiProvider: z.string().optional(),
  subscriptionType: z.string().nullable().optional(),
});
export type ClaudeAuthStatus = z.infer<typeof ClaudeAuthStatus>;

export interface ClaudeProbeDetail extends ConsultantProbe {
  authMethod?: string;
  apiProvider?: string;
  error?: ConsultantError;
}

/** Model aliases the CLI documents in `--help` (it resolves them to the newest model of each family). */
export const CLAUDE_MODEL_ALIASES = ["fable", "opus", "sonnet", "haiku"] as const;

export const CLAUDE_LOGIN_HINT =
  "Run `claude auth login` in a terminal (GhostHand never handles Claude logins)";

interface Captured {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function authKind(status: ClaudeAuthStatus): ConsultantProbe["auth"] {
  if (!status.loggedIn) return "none";
  const method = status.authMethod ?? "";
  if (/api.?key/i.test(method)) return "api_key";
  if (status.apiProvider !== undefined && status.apiProvider !== "firstParty") return "api_key";
  if (method === "claude.ai" || /oauth/i.test(method)) return "claude_ai";
  return "unknown";
}

export function parseVersion(stdout: string): string | undefined {
  return /(\d+\.\d+\.\d+\S*)/.exec(stdout)?.[1];
}

export class ClaudeConsultant implements AgentConsultant {
  readonly id = "claude";
  #binary: string;
  #spawn: SpawnFn;
  #env: NodeJS.ProcessEnv;
  #requestTimeoutMs: number;
  #askTimeoutMs: number;
  #tmpRoot: string;

  constructor(opts: ClaudeConsultantOptions = {}) {
    this.#binary = opts.binary ?? "claude";
    this.#spawn = opts.spawn ?? defaultSpawn;
    this.#env = claudeChildEnv(opts.env ?? process.env);
    this.#requestTimeoutMs = opts.requestTimeoutMs ?? 15_000;
    this.#askTimeoutMs = opts.askTimeoutMs ?? 180_000;
    this.#tmpRoot = opts.tmpRoot ?? tmpdir();
  }

  async probe(): Promise<ConsultantProbe> {
    const { installed, version, auth, plan, models } = await this.probeDetailed();
    return {
      installed,
      auth,
      models,
      ...(version === undefined ? {} : { version }),
      ...(plan === undefined ? {} : { plan }),
    };
  }

  /** `claude --version` and `claude auth status`. No model call, no credential files read. */
  async probeDetailed(): Promise<ClaudeProbeDetail> {
    const version = await this.#capture(["--version"]);
    if (!version.ok) {
      return version.error.kind === "not_installed"
        ? { installed: false, auth: "unknown", models: [], error: version.error }
        : { installed: true, auth: "unknown", models: [], error: version.error };
    }
    const v = parseVersion(version.value.stdout);
    const head = {
      installed: true,
      models: [...CLAUDE_MODEL_ALIASES],
      ...(v === undefined ? {} : { version: v }),
    };
    const status = await this.authStatus();
    if (!status.ok) return { ...head, auth: "unknown", error: status.error };
    const s = status.value;
    const auth = authKind(s);
    return {
      ...head,
      auth,
      ...(s.subscriptionType ? { plan: s.subscriptionType } : {}),
      ...(s.authMethod === undefined ? {} : { authMethod: s.authMethod }),
      ...(s.apiProvider === undefined ? {} : { apiProvider: s.apiProvider }),
      ...(auth === "none" ? { error: { kind: "unauthenticated" as const, message: CLAUDE_LOGIN_HINT } } : {}),
    };
  }

  /** `claude auth status --json` (exit code is not relied on: the JSON says whether we are logged in). */
  async authStatus(): Promise<Result<ClaudeAuthStatus, ConsultantError>> {
    const r = await this.#capture(["auth", "status", "--json"]);
    if (!r.ok) return r;
    let raw: unknown;
    try {
      raw = JSON.parse(r.value.stdout);
    } catch {
      return err({
        kind: "process",
        message: `claude auth status did not print JSON (exit ${r.value.code}): ${r.value.stderr.slice(0, 300)}`,
      });
    }
    const parsed = ClaudeAuthStatus.safeParse(raw);
    if (!parsed.success) return err({ kind: "process", message: "unexpected claude auth status output" });
    return ok(parsed.data);
  }

  /** Checks the login, then returns a session whose CLI processes start lazily on the first ask. */
  async open(opts: { system: string; model?: string }): Promise<Result<ClaudeSession, ConsultantError>> {
    const status = await this.authStatus();
    if (!status.ok) return status;
    if (!status.value.loggedIn) return err({ kind: "unauthenticated", message: CLAUDE_LOGIN_HINT });
    const cwd = await mkdtemp(join(this.#tmpRoot, "ghosthand-claude-"));
    return ok(
      new ClaudeSession({
        binary: this.#binary,
        spawn: this.#spawn,
        env: this.#env,
        system: opts.system,
        cwd,
        defaultTimeoutMs: this.#askTimeoutMs,
        onClose: () => rm(cwd, { recursive: true, force: true }),
        ...(opts.model === undefined ? {} : { model: opts.model }),
      }),
    );
  }

  async #capture(args: string[]): Promise<Result<Captured, ConsultantError>> {
    const started = await startProcess(this.#spawn, this.#binary, args, {
      env: this.#env,
      cwd: this.#tmpRoot,
    });
    if (!started.ok) return started;
    const child = started.value;
    const stdout = collectTail(child.stdout, 8000);
    const stderr = collectTail(child.stderr, 4000);
    child.stdin?.end();
    const code = await new Promise<number | null | "timeout">((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve("timeout");
      }, this.#requestTimeoutMs);
      child.once("exit", (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    if (code === "timeout") return err({ kind: "timeout", message: `claude ${args.join(" ")} timed out` });
    return ok({ code, stdout: stdout(), stderr: stderr() });
  }
}

export function createClaudeConsultant(opts: ClaudeConsultantOptions = {}): ClaudeConsultant {
  return new ClaudeConsultant(opts);
}
