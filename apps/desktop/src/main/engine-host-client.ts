// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Main's side of the engine host (an Electron utilityProcess running @ghosthand/engine): request/response
// correlation with timeouts, notices, crash handling with a bounded restart, and MessagePort hand-off.
// The process is injected (`spawn`) so this file has no Electron import and is unit-tested.
import {
  type HostCommandName,
  type HostCredentials,
  HostNotice,
  HostResponse,
  type IpcResponse,
  type Settings,
} from "@ghosthand/protocol";

export interface HostProcess {
  postMessage(message: unknown, transfer?: unknown[]): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  kill(): boolean;
}

export interface EngineHostClientOptions {
  spawn: () => HostProcess;
  onNotice?: (notice: HostNotice) => void;
  /** Called after an unexpected exit, before any restart. */
  onExit?: (code: number, willRestart: boolean) => void;
  onReady?: () => void;
  maxRestarts?: number;
}

export interface RequestExtras {
  settings?: Settings;
  credentials?: HostCredentials;
  timeoutMs?: number;
}

interface Pending {
  resolve: (r: IpcResponse<unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class EngineHostClient {
  readonly #opts: EngineHostClientOptions;
  readonly #pending = new Map<number, Pending>();
  #proc: HostProcess | undefined;
  #nextId = 1;
  #restarts = 0;
  #stopping = false;
  #lastPort: unknown;

  constructor(opts: EngineHostClientOptions) {
    this.#opts = opts;
  }

  get running(): boolean {
    return this.#proc !== undefined;
  }

  start(): void {
    if (this.#proc) return;
    this.#stopping = false;
    const proc = this.#opts.spawn();
    this.#proc = proc;
    proc.on("message", (m) => this.#onMessage(m));
    proc.on("exit", (code) => this.#onExit(proc, code));
  }

  stop(): void {
    this.#stopping = true;
    const proc = this.#proc;
    this.#proc = undefined;
    this.#failAll("engine host stopped");
    proc?.kill();
  }

  /** Hands a renderer MessagePort to the host; remembered so a restarted host gets a fresh one later. */
  sendPort(port: unknown): void {
    this.#lastPort = port;
    this.#proc?.postMessage({ kind: "port" }, [port]);
  }

  get hasPort(): boolean {
    return this.#lastPort !== undefined;
  }

  request(
    command: HostCommandName,
    input: unknown,
    extras: RequestExtras = {},
  ): Promise<IpcResponse<unknown>> {
    const proc = this.#proc;
    if (!proc) {
      return Promise.resolve({ ok: false, error: { kind: "unavailable", message: "engine is not running" } });
    }
    const id = this.#nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve({ ok: false, error: { kind: "engine", message: `${command} timed out` } });
      }, extras.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      this.#pending.set(id, { resolve, timer });
      proc.postMessage({
        kind: "request",
        id,
        command,
        input,
        ...(extras.settings ? { settings: extras.settings } : {}),
        ...(extras.credentials ? { credentials: extras.credentials } : {}),
      });
    });
  }

  #onMessage(raw: unknown): void {
    const response = HostResponse.safeParse(raw);
    if (response.success) {
      const r = response.data;
      const pending = this.#pending.get(r.id);
      if (!pending) return;
      this.#pending.delete(r.id);
      clearTimeout(pending.timer);
      pending.resolve(
        r.ok
          ? { ok: true, value: r.value ?? null }
          : { ok: false, error: r.error ?? { kind: "engine", message: "engine error" } },
      );
      return;
    }
    const notice = HostNotice.safeParse(raw);
    if (!notice.success) return;
    if (notice.data.kind === "ready") {
      this.#restarts = 0;
      this.#opts.onReady?.();
    }
    this.#opts.onNotice?.(notice.data);
  }

  #failAll(message: string): void {
    for (const [id, p] of this.#pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: { kind: "engine", message } });
      this.#pending.delete(id);
    }
  }

  #onExit(proc: HostProcess, code: number): void {
    if (this.#proc !== proc) return;
    this.#proc = undefined;
    this.#failAll(`engine host exited (code ${code})`);
    if (this.#stopping) return;
    const willRestart = this.#restarts < (this.#opts.maxRestarts ?? 3);
    this.#opts.onExit?.(code, willRestart);
    if (willRestart) {
      this.#restarts++;
      this.start();
    }
  }
}
