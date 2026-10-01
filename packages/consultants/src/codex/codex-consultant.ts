// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// AgentConsultant over the user's own signed-in Codex CLI. GhostHand never reads or stores Codex credentials:
// Codex owns its login (`codex login`), and we only ask it whether it is signed in.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConsultant, ConsultantError, ConsultantProbe, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { AccountInfo, RateLimitsDetail } from "./account.ts";
import { listModels, readAccount, readRateLimits, requireSignedIn, unauthenticated } from "./account.ts";
import { AppServerConnection } from "./app-server-connection.ts";
import { CodexAppServerSession } from "./app-server-session.ts";
import type { SpawnFn } from "./child-process.ts";
import { collectTail, defaultSpawn, startProcess } from "./child-process.ts";
import { CodexExecSession } from "./exec-session.ts";

export type CodexTransport = "app-server" | "exec";

export interface CodexConsultantOptions {
  /** Path or name of the Codex CLI. Default `codex` (resolved on PATH). */
  binary?: string;
  /** `app-server` (default, warm process) or `exec` (one process per ask, fallback). */
  transport?: CodexTransport;
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnFn;
  /** Reported in `clientInfo.version`. */
  clientVersion?: string;
  /** Timeout for control requests such as initialize and thread/start. Default 30 s. */
  requestTimeoutMs?: number;
  /** Default timeout per ask when the caller gives none. Default 120 s. */
  askTimeoutMs?: number;
  /** Parent for the session's private working directory. Default the OS temp dir. */
  tmpRoot?: string;
}

export type CodexSession = CodexAppServerSession | CodexExecSession;

export interface CodexProbeDetail extends ConsultantProbe {
  transport: CodexTransport;
  error?: ConsultantError;
  spawnToInitializedMs?: number;
  rateLimits?: RateLimitsDetail;
}

interface Captured {
  code: number | null;
  stdout: string;
  stderr: string;
}

const NOT_INSTALLED: ConsultantProbe = { installed: false, auth: "unknown", models: [] };

export class CodexConsultant implements AgentConsultant {
  readonly id = "codex";
  readonly transport: CodexTransport;
  #binary: string;
  #spawn: SpawnFn;
  #env: NodeJS.ProcessEnv | undefined;
  #clientVersion: string;
  #requestTimeoutMs: number;
  #askTimeoutMs: number;
  #tmpRoot: string;

  constructor(opts: CodexConsultantOptions = {}) {
    this.transport = opts.transport ?? "app-server";
    this.#binary = opts.binary ?? "codex";
    this.#spawn = opts.spawn ?? defaultSpawn;
    this.#env = opts.env;
    this.#clientVersion = opts.clientVersion ?? "0.0.0";
    this.#requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
    this.#askTimeoutMs = opts.askTimeoutMs ?? 120_000;
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

  /** Probe plus timings, the failure (if any) and, with `rateLimits: true`, the current rate limits. */
  async probeDetailed(opts: { rateLimits?: boolean } = {}): Promise<CodexProbeDetail> {
    return this.transport === "exec" ? this.#probeExec() : this.#probeAppServer(opts.rateLimits === true);
  }

  async open(opts: { system: string; model?: string }): Promise<Result<CodexSession, ConsultantError>> {
    const cwd = await mkdtemp(join(this.#tmpRoot, "ghosthand-codex-"));
    const cleanup = (): Promise<void> => rm(cwd, { recursive: true, force: true });
    const r =
      this.transport === "exec"
        ? await this.#openExec(opts, cwd, cleanup)
        : await this.#openAppServer(opts, cwd, cleanup);
    if (!r.ok) await cleanup();
    return r;
  }

  #connect(cwd?: string): Promise<Result<AppServerConnection, ConsultantError>> {
    return AppServerConnection.start({
      binary: this.#binary,
      spawn: this.#spawn,
      clientVersion: this.#clientVersion,
      requestTimeoutMs: this.#requestTimeoutMs,
      ...(this.#env === undefined ? {} : { env: this.#env }),
      ...(cwd === undefined ? {} : { cwd }),
    });
  }

  async #openAppServer(
    opts: { system: string; model?: string },
    cwd: string,
    cleanup: () => Promise<void>,
  ): Promise<Result<CodexSession, ConsultantError>> {
    const conn = await this.#connect(cwd);
    if (!conn.ok) return conn;
    const account = await readAccount(conn.value);
    const signedIn = account.ok ? requireSignedIn(account.value) : account;
    if (!signedIn.ok) {
      await conn.value.close();
      return signedIn;
    }
    const session = await CodexAppServerSession.open(conn.value, {
      system: opts.system,
      cwd,
      defaultTimeoutMs: this.#askTimeoutMs,
      onClose: cleanup,
      ...(opts.model === undefined ? {} : { model: opts.model }),
    });
    if (!session.ok) await conn.value.close();
    return session;
  }

  async #openExec(
    opts: { system: string; model?: string },
    cwd: string,
    cleanup: () => Promise<void>,
  ): Promise<Result<CodexSession, ConsultantError>> {
    const status = await this.#loginStatus();
    if (!status.ok) return status;
    if (status.value.auth === "none") return err(unauthenticated());
    return ok(
      new CodexExecSession({
        binary: this.#binary,
        spawn: this.#spawn,
        system: opts.system,
        cwd,
        defaultTimeoutMs: this.#askTimeoutMs,
        onClose: cleanup,
        ...(this.#env === undefined ? {} : { env: this.#env }),
        ...(opts.model === undefined ? {} : { model: opts.model }),
      }),
    );
  }

  async #probeAppServer(withRateLimits: boolean): Promise<CodexProbeDetail> {
    const base = { transport: "app-server" as const };
    const conn = await this.#connect(this.#tmpRoot);
    if (!conn.ok) {
      return conn.error.kind === "not_installed"
        ? { ...NOT_INSTALLED, ...base, error: conn.error }
        : { installed: true, auth: "unknown", models: [], ...base, error: conn.error };
    }
    const c = conn.value;
    try {
      const head = {
        installed: true,
        ...base,
        ...(c.version === undefined ? {} : { version: c.version }),
        spawnToInitializedMs: c.spawnToInitializedMs,
      };
      const account = await readAccount(c);
      if (!account.ok) return { ...head, auth: "unknown", models: [], error: account.error };
      const signedIn = requireSignedIn(account.value);
      const withAccount = {
        ...head,
        auth: account.value.auth,
        ...(account.value.plan === undefined ? {} : { plan: account.value.plan }),
      };
      if (!signedIn.ok) return { ...withAccount, models: [], error: signedIn.error };
      const models = await listModels(c);
      if (!models.ok) return { ...withAccount, models: [], error: models.error };
      const ids = models.value.map((m) => m.id);
      if (!withRateLimits) return { ...withAccount, models: ids };
      const limits = await readRateLimits(c);
      return limits.ok
        ? { ...withAccount, models: ids, rateLimits: limits.value }
        : { ...withAccount, models: ids, error: limits.error };
    } finally {
      await c.close();
    }
  }

  async #probeExec(): Promise<CodexProbeDetail> {
    const base = { transport: "exec" as const };
    const version = await this.#capture(["--version"]);
    if (!version.ok) {
      return version.error.kind === "not_installed"
        ? { ...NOT_INSTALLED, ...base, error: version.error }
        : { installed: true, auth: "unknown", models: [], ...base, error: version.error };
    }
    const v = /(\d+\.\d+\.\d+\S*)/.exec(version.value.stdout)?.[1];
    const head = { installed: true, ...base, ...(v === undefined ? {} : { version: v }) };
    const status = await this.#loginStatus();
    if (!status.ok) return { ...head, auth: "unknown", models: [], error: status.error };
    return {
      ...head,
      auth: status.value.auth,
      models: [],
      ...(status.value.auth === "none" ? { error: unauthenticated() } : {}),
    };
  }

  /** `codex login status`: prints "Logged in using ChatGPT" (exit 0) or "Not logged in" (exit 1). No secrets. */
  async #loginStatus(): Promise<Result<AccountInfo, ConsultantError>> {
    const r = await this.#capture(["login", "status"]);
    if (!r.ok) return r;
    const text = `${r.value.stdout}\n${r.value.stderr}`;
    if (/not logged in/i.test(text)) return ok({ auth: "none", requiresOpenaiAuth: true });
    if (/chatgpt/i.test(text)) return ok({ auth: "chatgpt", requiresOpenaiAuth: true });
    if (/api key/i.test(text)) return ok({ auth: "api_key", requiresOpenaiAuth: true });
    return ok({ auth: r.value.code === 0 ? "unknown" : "none", requiresOpenaiAuth: true });
  }

  async #capture(args: string[]): Promise<Result<Captured, ConsultantError>> {
    const started = await startProcess(this.#spawn, this.#binary, args, {
      ...(this.#env === undefined ? {} : { env: this.#env }),
    });
    if (!started.ok) return started;
    const child = started.value;
    const stdout = collectTail(child.stdout, 4000);
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
    if (code === "timeout") {
      return err({ kind: "timeout", message: `codex ${args.join(" ")} timed out` });
    }
    return ok({ code, stdout: stdout(), stderr: stderr() });
  }
}

export function createCodexConsultant(opts: CodexConsultantOptions = {}): CodexConsultant {
  return new CodexConsultant(opts);
}
