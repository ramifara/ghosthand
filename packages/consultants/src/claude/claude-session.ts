// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A ConsultantSession over warm `claude --print --input-format stream-json` processes. `--json-schema`
// is fixed per process, so the session keeps one process per (schema, effort) pair and pushes one user
// message per ask into it; asks are serialised. A timeout, abort or interrupt kills that process (the
// next ask starts a fresh one), so a stuck turn never blocks the session.
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { performance } from "node:perf_hooks";
import type {
  ConsultantAskOptions,
  ConsultantError,
  ConsultantSession,
  RateLimits,
  Result,
} from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import { parseAnswer } from "../codex/answer.ts";
import type { ChildProcessLike, SpawnFn } from "../codex/child-process.ts";
import { collectTail, startProcess, stopProcess } from "../codex/child-process.ts";
import { LineDecoder } from "../codex/json-rpc-client.ts";
import { stopError, watchStop } from "../codex/stop-watch.ts";
import type { ClaudeEffort } from "./claude-args.ts";
import { claudeStreamArgs } from "./claude-args.ts";
import type { ClaudeRateLimit, ClaudeResult } from "./stream-events.ts";
import { claudeKindFromMessage, parseClaudeEvent, resultError, toRateLimits } from "./stream-events.ts";

export interface ClaudeSessionOptions {
  readonly binary: string;
  readonly spawn: SpawnFn;
  readonly env: NodeJS.ProcessEnv;
  readonly system: string;
  readonly model?: string;
  /** Private empty working directory; the CLI has no tools, but its cwd still shows in its prompt. */
  readonly cwd: string;
  readonly defaultTimeoutMs: number;
  /** Most warm processes kept at once (oldest is stopped first). Default 3. */
  readonly maxProcesses?: number;
  readonly onClose?: () => Promise<void>;
}

export interface ClaudeTurnStats {
  /** Wall time from writing the message to the `result` event. */
  readonly latencyMs: number;
  /** Process start to `system/init`, when this turn started the process. */
  readonly spawnToInitMs?: number;
  /**
   * The CLI's own `duration_ms` (this turn) and `total_cost_usd` (cumulative for the process, an API-price
   * estimate; subscription users are not billed per call).
   */
  readonly durationMs?: number;
  readonly costUsd?: number;
  readonly model?: string;
}

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

type TurnEnd =
  | { readonly kind: "result"; readonly result: ClaudeResult }
  | { readonly kind: "exit"; readonly code: number | null; readonly signal: string | null };

/** One warm CLI process and the turn currently waiting on it. */
class ClaudeProcess {
  readonly child: ChildProcessLike;
  readonly exited: Promise<{ code: number | null; signal: string | null }>;
  readonly stderr: () => string;
  readonly started = performance.now();
  initAt: number | undefined;
  model: string | undefined;
  #waiter: ((end: TurnEnd) => void) | undefined;

  constructor(child: ChildProcessLike, onRateLimit: (info: ClaudeRateLimit) => void) {
    this.child = child;
    this.stderr = collectTail(child.stderr);
    this.exited = new Promise((resolve) =>
      child.once("exit", (code, signal) => {
        resolve({ code, signal });
        this.#waiter?.({ kind: "exit", code, signal });
      }),
    );
    const lines = new LineDecoder();
    child.stdout?.on("data", (chunk: Uint8Array | string) => {
      for (const line of lines.push(chunk)) {
        const event = parseClaudeEvent(line);
        if (event.kind === "init") {
          this.initAt ??= performance.now();
          this.model = event.init.model;
        } else if (event.kind === "rate_limit") {
          onRateLimit(event.info);
        } else if (event.kind === "result") {
          const waiter = this.#waiter;
          this.#waiter = undefined;
          waiter?.({ kind: "result", result: event.result });
        }
      }
    });
    child.stdin?.on("error", () => {});
  }

  get alive(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  /** Writes one user message and resolves with its `result` (or the process exit). */
  send(message: unknown): Promise<TurnEnd> {
    return new Promise((resolve) => {
      if (!this.alive) {
        resolve({ kind: "exit", code: this.child.exitCode, signal: this.child.signalCode });
        return;
      }
      this.#waiter = resolve;
      this.child.stdin?.write(`${JSON.stringify(message)}\n`);
    });
  }

  async kill(): Promise<void> {
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 2000);
    await this.exited;
    clearTimeout(timer);
  }
}

async function imageBlock(path: string): Promise<Result<Record<string, unknown>, ConsultantError>> {
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()];
  if (mediaType === undefined) return err({ kind: "process", message: `unsupported image type: ${path}` });
  try {
    const data = (await readFile(path)).toString("base64");
    return ok({ type: "image", source: { type: "base64", media_type: mediaType, data } });
  } catch (e) {
    return err({
      kind: "process",
      message: `cannot read image ${path}: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

export class ClaudeSession implements ConsultantSession {
  #opts: ClaudeSessionOptions;
  #procs = new Map<string, ClaudeProcess>();
  #queue: Promise<unknown> = Promise.resolve();
  #interruptActive: (() => void) | undefined;
  #rateLimit: ClaudeRateLimit | undefined;
  #closed = false;
  lastStats: ClaudeTurnStats | undefined;

  constructor(opts: ClaudeSessionOptions) {
    this.#opts = opts;
  }

  ask<T>(opts: ConsultantAskOptions<T>): Promise<Result<T, ConsultantError>> {
    const run = this.#queue.then(() => this.#run(opts));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async rateLimits(): Promise<Result<RateLimits, ConsultantError>> {
    if (this.#rateLimit === undefined) {
      return err({ kind: "process", message: "no rate-limit event yet; Claude reports limits after a turn" });
    }
    return ok(toRateLimits(this.#rateLimit));
  }

  async interrupt(): Promise<void> {
    this.#interruptActive?.();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#interruptActive?.();
    const procs = [...this.#procs.values()];
    this.#procs.clear();
    await Promise.all(procs.map((p) => stopProcess(p.child)));
    await this.#opts.onClose?.();
  }

  /** Number of warm processes (for tests and diagnostics). */
  get warmProcesses(): number {
    return this.#procs.size;
  }

  async #process(
    schema: Record<string, unknown>,
    effort: ClaudeEffort | undefined,
  ): Promise<Result<ClaudeProcess, ConsultantError>> {
    const key = JSON.stringify([schema, effort ?? null]);
    const existing = this.#procs.get(key);
    if (existing?.alive === true) {
      // Most recently used goes last.
      this.#procs.delete(key);
      this.#procs.set(key, existing);
      return ok(existing);
    }
    this.#procs.delete(key);
    const max = this.#opts.maxProcesses ?? 3;
    while (this.#procs.size >= max) {
      const [oldestKey, oldest] = this.#procs.entries().next().value ?? [];
      if (oldestKey === undefined || oldest === undefined) break;
      this.#procs.delete(oldestKey);
      void stopProcess(oldest.child);
    }
    const args = claudeStreamArgs({
      system: this.#opts.system,
      schema,
      ...(this.#opts.model === undefined ? {} : { model: this.#opts.model }),
      ...(effort === undefined ? {} : { effort }),
    });
    const started = await startProcess(this.#opts.spawn, this.#opts.binary, args, {
      cwd: this.#opts.cwd,
      env: this.#opts.env,
    });
    if (!started.ok) return started;
    const proc = new ClaudeProcess(started.value, (info) => {
      this.#rateLimit = info;
    });
    this.#procs.set(key, proc);
    return ok(proc);
  }

  #drop(proc: ClaudeProcess): void {
    for (const [k, v] of this.#procs) if (v === proc) this.#procs.delete(k);
  }

  async #run<T>(opts: ConsultantAskOptions<T>): Promise<Result<T, ConsultantError>> {
    if (this.#closed) return err({ kind: "process", message: "the Claude session is closed" });
    if (opts.signal?.aborted) return err(stopError("cancelled", 0, "Claude"));
    const timeoutMs = opts.timeoutMs ?? this.#opts.defaultTimeoutMs;

    const content: Record<string, unknown>[] = [{ type: "text", text: opts.prompt }];
    for (const path of opts.images ?? []) {
      const block = await imageBlock(path);
      if (!block.ok) return block;
      content.push(block.value);
    }

    const proc = await this.#process(opts.schema, opts.effort);
    if (!proc.ok) return proc;
    const p = proc.value;
    const freshProcess = p.initAt === undefined;
    const watch = watchStop(timeoutMs, opts.signal);
    this.#interruptActive = () => watch.interrupt();
    const t0 = performance.now();
    try {
      const end = await Promise.race([
        p.send({ type: "user", message: { role: "user", content } }),
        watch.stopped,
      ]);
      if (typeof end === "string") {
        this.#drop(p);
        await p.kill();
        return err(stopError(end, timeoutMs, "Claude"));
      }
      if (end.kind === "exit") {
        this.#drop(p);
        const stderr = p.stderr();
        const message = stderr || `claude exited with ${end.signal ?? end.code}`;
        return err({ kind: claudeKindFromMessage(message), message: message.slice(0, 1000) });
      }
      const r = end.result;
      this.lastStats = {
        latencyMs: performance.now() - t0,
        ...(freshProcess && p.initAt !== undefined ? { spawnToInitMs: p.initAt - p.started } : {}),
        ...(r.duration_ms === undefined ? {} : { durationMs: r.duration_ms }),
        ...(r.total_cost_usd === undefined ? {} : { costUsd: r.total_cost_usd }),
        ...(p.model === undefined ? {} : { model: p.model }),
      };
      if (r.is_error || r.subtype !== "success") return err(resultError(r));
      if (r.structured_output !== undefined) {
        try {
          return ok(opts.parse(r.structured_output));
        } catch (e) {
          return err({
            kind: "schema_failed",
            message:
              `structured output failed validation: ${e instanceof Error ? e.message : String(e)}`.slice(
                0,
                2000,
              ),
          });
        }
      }
      // Older CLIs or a model that answered in text: parse the final text ourselves.
      return parseAnswer(r.result, opts.parse);
    } finally {
      watch.dispose();
      this.#interruptActive = undefined;
    }
  }
}
