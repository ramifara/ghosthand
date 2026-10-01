// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// One running `codex app-server` process: spawn, `initialize` + `initialized`, typed requests, shutdown.
import { performance } from "node:perf_hooks";
import type { ConsultantError, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { z } from "zod";
import { InitializeResult } from "./app-server-protocol.ts";
import type { ChildProcessLike, SpawnFn } from "./child-process.ts";
import { collectTail, startProcess, stopProcess } from "./child-process.ts";
import { fromRpcFailure } from "./errors.ts";
import type { NotificationHandler, RequestOptions } from "./json-rpc-client.ts";
import { JsonRpcClient } from "./json-rpc-client.ts";
import { declineServerRequest } from "./server-requests.ts";

export interface AppServerConnectionOptions {
  binary: string;
  spawn: SpawnFn;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  clientVersion: string;
  /** Timeout for control requests (initialize, account/read, model/list, thread/start, ...). */
  requestTimeoutMs: number;
  /** Extra arguments after `app-server`, e.g. `["-c", "model_reasoning_summary=\"none\""]`. */
  extraArgs?: readonly string[];
}

/** `ghosthand/0.159.2 (CachyOS ...; x86_64) ...` → `0.159.2`. */
export function versionFromUserAgent(userAgent: string): string | undefined {
  return /^[^/\s]+\/(\d[^\s]*)/.exec(userAgent)?.[1];
}

export class AppServerConnection {
  readonly client: JsonRpcClient;
  readonly userAgent: string;
  readonly version: string | undefined;
  readonly spawnToInitializedMs: number;
  #child: ChildProcessLike;
  #stderrTail: () => string;
  #requestTimeoutMs: number;

  private constructor(
    child: ChildProcessLike,
    client: JsonRpcClient,
    stderrTail: () => string,
    init: { userAgent: string; spawnToInitializedMs: number; requestTimeoutMs: number },
  ) {
    this.#child = child;
    this.client = client;
    this.#stderrTail = stderrTail;
    this.userAgent = init.userAgent;
    this.version = versionFromUserAgent(init.userAgent);
    this.spawnToInitializedMs = init.spawnToInitializedMs;
    this.#requestTimeoutMs = init.requestTimeoutMs;
  }

  static async start(
    opts: AppServerConnectionOptions,
  ): Promise<Result<AppServerConnection, ConsultantError>> {
    const t0 = performance.now();
    const started = await startProcess(opts.spawn, opts.binary, ["app-server", ...(opts.extraArgs ?? [])], {
      ...(opts.env === undefined ? {} : { env: opts.env }),
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    });
    if (!started.ok) return started;
    const child = started.value;
    if (!child.stdin || !child.stdout) {
      child.kill("SIGKILL");
      return err({ kind: "process", message: "codex app-server started without stdio pipes" });
    }
    const stderrTail = collectTail(child.stderr);
    const client = new JsonRpcClient(
      { input: child.stdout, output: child.stdin },
      { onRequest: (method) => declineServerRequest(method) },
    );
    child.once("exit", (code, signal) => {
      const tail = stderrTail();
      client.close(
        `codex app-server exited (${signal ?? `code ${code}`})${tail ? `: ${tail.slice(-500)}` : ""}`,
      );
    });

    const init = await client.request(
      "initialize",
      {
        clientInfo: { name: "ghosthand", title: "GhostHand", version: opts.clientVersion },
        capabilities: { experimentalApi: false, requestAttestation: false },
      },
      { timeoutMs: opts.requestTimeoutMs },
    );
    if (!init.ok) {
      await stopProcess(child, 200);
      return err(fromRpcFailure(init.error));
    }
    const parsed = InitializeResult.safeParse(init.value);
    if (!parsed.success) {
      await stopProcess(child, 200);
      return err({ kind: "process", message: `unexpected initialize response: ${parsed.error.message}` });
    }
    client.notify("initialized");
    return ok(
      new AppServerConnection(child, client, stderrTail, {
        userAgent: parsed.data.userAgent,
        spawnToInitializedMs: performance.now() - t0,
        requestTimeoutMs: opts.requestTimeoutMs,
      }),
    );
  }

  get closed(): boolean {
    return this.client.closed;
  }

  get stderrTail(): string {
    return this.#stderrTail();
  }

  async request<T>(
    method: string,
    params: unknown,
    schema: z.ZodType<T>,
    opts: RequestOptions = {},
  ): Promise<Result<T, ConsultantError>> {
    const r = await this.client.request(method, params, { timeoutMs: this.#requestTimeoutMs, ...opts });
    if (!r.ok) return err(fromRpcFailure(r.error));
    const parsed = schema.safeParse(r.value);
    if (!parsed.success) {
      return err({ kind: "process", message: `unexpected ${method} response: ${parsed.error.message}` });
    }
    return ok(parsed.data);
  }

  onNotification(handler: NotificationHandler): () => void {
    return this.client.onNotification(handler);
  }

  async close(): Promise<void> {
    this.client.close("closed by client");
    await stopProcess(this.#child);
  }
}
