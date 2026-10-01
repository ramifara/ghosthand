// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// JSON-RPC 2.0 client over newline-delimited JSON on a child process's stdio. One host per process;
// requests are answered in order, but the client matches responses by id anyway.
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Logger } from "@ghosthand/core";
import { noopLogger } from "@ghosthand/core";
import type {
  ComputerError,
  DesktopRpcMethod,
  DesktopRpcParams,
  DesktopRpcResult,
  Result,
  RpcErrorKind,
} from "@ghosthand/protocol";
import { DESKTOP_RPC_METHODS, err, ok, RpcNotification, RpcResponse } from "@ghosthand/protocol";

export interface RpcCallError {
  kind: RpcErrorKind | "closed" | "protocol";
  message: string;
}

export interface RpcTransport {
  call<M extends DesktopRpcMethod>(
    method: M,
    params: DesktopRpcParams<M>,
    opts?: { timeoutMs?: number },
  ): Promise<Result<DesktopRpcResult<M>, RpcCallError>>;
  close(): Promise<void>;
  readonly closed: boolean;
}

interface Pending {
  method: DesktopRpcMethod;
  resolve: (r: Result<unknown, RpcCallError>) => void;
  timer: NodeJS.Timeout;
}

export interface SpawnHostOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Wait for the host's `ready` notification (sandbox start-up included). Default 60 s. */
  startupTimeoutMs?: number;
  /** Default per-call timeout. Default 30 s. */
  callTimeoutMs?: number;
  logger?: Logger;
  /** Extra cleanup after the process exits (e.g. `docker rm -f`). */
  onExit?: () => Promise<void> | void;
}

const MAX_LINE = 64 * 1024 * 1024;

export class StdioRpcClient implements RpcTransport {
  readonly #child: ChildProcess;
  readonly #pending = new Map<number, Pending>();
  readonly #log: Logger;
  readonly #callTimeout: number;
  readonly #onExit: (() => Promise<void> | void) | undefined;
  #nextId = 1;
  #closed = false;
  #exited: Promise<void>;
  #ready: Promise<Result<void, ComputerError>>;

  constructor(child: ChildProcess, opts: Omit<SpawnHostOptions, "command" | "args">) {
    this.#child = child;
    this.#log = (opts.logger ?? noopLogger).child({ component: "desktop-rpc" });
    this.#callTimeout = opts.callTimeoutMs ?? 30_000;
    this.#onExit = opts.onExit;
    let readyResolve: (r: Result<void, ComputerError>) => void = () => {};
    this.#ready = new Promise((resolve) => {
      readyResolve = resolve;
    });
    const startup = setTimeout(
      () => readyResolve(err({ kind: "launch_failed", message: "the desktop host did not start in time" })),
      opts.startupTimeoutMs ?? 60_000,
    );
    this.#exited = new Promise((resolve) => {
      child.once("exit", (code, signal) => {
        clearTimeout(startup);
        this.#closed = true;
        readyResolve(
          err({ kind: "launch_failed", message: `the desktop host exited (${signal ?? `code ${code}`})` }),
        );
        this.#failAll({ kind: "closed", message: `the desktop host exited (${signal ?? `code ${code}`})` });
        resolve();
      });
      child.once("error", (e) => {
        clearTimeout(startup);
        this.#closed = true;
        readyResolve(err({ kind: "launch_failed", message: `cannot start the desktop host: ${e.message}` }));
        this.#failAll({ kind: "closed", message: e.message });
        resolve();
      });
    });
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
      rl.on("line", (line) => {
        if (line.length > MAX_LINE) {
          this.#log.warn({ bytes: line.length }, "oversized line from the desktop host dropped");
          return;
        }
        this.#onLine(line, (r) => {
          clearTimeout(startup);
          readyResolve(r);
        });
      });
    }
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr, crlfDelay: Number.POSITIVE_INFINITY });
      // Host logs never carry typed values (host rule); keep them at debug and short.
      rl.on("line", (line) => this.#log.debug({ host: line.slice(0, 500) }, "host"));
    }
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Resolves when the host announced `ready`, or with the start-up failure. */
  ready(): Promise<Result<void, ComputerError>> {
    return this.#ready;
  }

  #onLine(line: string, onReady: (r: Result<void, ComputerError>) => void): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      this.#log.warn({ line: trimmed.slice(0, 200) }, "non-JSON line on the desktop host's stdout");
      return;
    }
    if (typeof raw === "object" && raw !== null && "method" in raw && !("id" in raw)) {
      const n = RpcNotification.safeParse(raw);
      if (!n.success) return;
      if (n.data.method === "ready") onReady(ok(undefined));
      else if (n.data.method === "fatal") {
        const message = typeof n.data.params?.message === "string" ? n.data.params.message : "fatal";
        onReady(err({ kind: "launch_failed", message }));
      }
      return;
    }
    const parsed = RpcResponse.safeParse(raw);
    if (!parsed.success) {
      this.#log.warn({}, "malformed response from the desktop host");
      return;
    }
    const msg = parsed.data;
    const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    if ("error" in msg) {
      pending.resolve(err({ kind: msg.error.data?.kind ?? "driver", message: msg.error.message }));
      return;
    }
    const schema = DESKTOP_RPC_METHODS[pending.method].result;
    const result = schema.safeParse(msg.result);
    if (!result.success) {
      pending.resolve(
        err({
          kind: "protocol",
          message: `bad ${pending.method} result: ${result.error.issues[0]?.message ?? "invalid"} at ${result.error.issues[0]?.path.join(".") ?? ""}`,
        }),
      );
      return;
    }
    pending.resolve(ok(result.data));
  }

  #failAll(e: RpcCallError): void {
    for (const [id, p] of this.#pending) {
      clearTimeout(p.timer);
      p.resolve(err(e));
      this.#pending.delete(id);
    }
  }

  call<M extends DesktopRpcMethod>(
    method: M,
    params: DesktopRpcParams<M>,
    opts?: { timeoutMs?: number },
  ): Promise<Result<DesktopRpcResult<M>, RpcCallError>> {
    if (this.#closed || !this.#child.stdin || this.#child.stdin.destroyed)
      return Promise.resolve(err({ kind: "closed", message: "the desktop host is not running" }));
    const id = this.#nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve(err({ kind: "timeout", message: `${method} timed out` }));
      }, opts?.timeoutMs ?? this.#callTimeout);
      this.#pending.set(id, {
        method,
        resolve: resolve as (r: Result<unknown, RpcCallError>) => void,
        timer,
      });
      const line = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
      this.#child.stdin?.write(line, (e) => {
        if (!e) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        resolve(err({ kind: "closed", message: `cannot write to the desktop host: ${e.message}` }));
      });
    });
  }

  async close(): Promise<void> {
    if (!this.#closed) {
      await this.call("close", {}, { timeoutMs: 5000 });
      this.#child.stdin?.end();
      const exited = await Promise.race([
        this.#exited.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 8000)),
      ]);
      if (!exited) {
        this.#child.kill("SIGTERM");
        const gone = await Promise.race([
          this.#exited.then(() => true),
          new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
        ]);
        if (!gone) this.#child.kill("SIGKILL");
      }
    }
    this.#closed = true;
    await this.#onExit?.();
  }
}

/** Spawns a host process and waits for its `ready` notification. */
export async function spawnRpcHost(opts: SpawnHostOptions): Promise<Result<StdioRpcClient, ComputerError>> {
  let child: ChildProcess;
  try {
    child = spawn(opts.command, opts.args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });
  } catch (e) {
    return err({ kind: "launch_failed", message: e instanceof Error ? e.message : String(e) });
  }
  const client = new StdioRpcClient(child, opts);
  const ready = await client.ready();
  if (!ready.ok) {
    await client.close();
    return ready;
  }
  return ok(client);
}
