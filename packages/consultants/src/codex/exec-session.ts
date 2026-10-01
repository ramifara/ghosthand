// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Fallback transport: one `codex exec` process per ask, with --output-schema, -i images and a read-only sandbox.
// No warm process, so expect a few seconds more per ask than app-server. No bypass or auto-approve flags are
// ever passed.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type {
  ConsultantAskOptions,
  ConsultantError,
  ConsultantSession,
  RateLimits,
  Result,
} from "@ghosthand/protocol";
import { err } from "@ghosthand/protocol";
import { parseAnswer } from "./answer.ts";
import type { SpawnFn } from "./child-process.ts";
import { collectTail, startProcess } from "./child-process.ts";
import { kindFromMessage } from "./errors.ts";
import { LineDecoder } from "./json-rpc-client.ts";
import { stopError, watchStop } from "./stop-watch.ts";

export interface ExecSessionOptions {
  binary: string;
  spawn: SpawnFn;
  env?: NodeJS.ProcessEnv;
  system: string;
  model?: string;
  /** Working root for the agent (`-C`); a private temp dir. Scratch files go in per-ask subdirectories. */
  cwd: string;
  defaultTimeoutMs: number;
  onClose?: () => Promise<void>;
}

/** Builds the argv for one ask. Exported for tests. */
export function execArgs(o: {
  cwd: string;
  schemaPath: string;
  outPath: string;
  system: string;
  model?: string;
  effort?: string;
  images: readonly string[];
}): string[] {
  return [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-C",
    o.cwd,
    "--output-schema",
    o.schemaPath,
    "-o",
    o.outPath,
    "--json",
    "-c",
    // A JSON string literal is a valid TOML basic string.
    `developer_instructions=${JSON.stringify(o.system)}`,
    ...(o.model === undefined ? [] : ["-m", o.model]),
    ...(o.effort === undefined ? [] : ["-c", `model_reasoning_effort=${JSON.stringify(o.effort)}`]),
    // The prompt comes from stdin. `-` goes before `--image`, which takes one or more values.
    "-",
    ...o.images.flatMap((p) => ["--image", p]),
  ];
}

interface ExecEvents {
  failure?: string;
  lastError?: string;
  agentText?: string;
}

/** Reads `codex exec --json` events: `turn.failed`, `error`, `item.completed` (agent_message). */
export function readExecEvent(events: ExecEvents, line: string): void {
  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof ev !== "object" || ev === null) return;
  const type: unknown = Reflect.get(ev, "type");
  if (type === "turn.failed") {
    const e: unknown = Reflect.get(ev, "error");
    const msg = typeof e === "object" && e !== null ? Reflect.get(e, "message") : undefined;
    events.failure = typeof msg === "string" ? msg : "turn failed";
  } else if (type === "error") {
    const msg: unknown = Reflect.get(ev, "message");
    if (typeof msg === "string") events.lastError = msg;
  } else if (type === "item.completed") {
    const item: unknown = Reflect.get(ev, "item");
    if (typeof item === "object" && item !== null && Reflect.get(item, "type") === "agent_message") {
      const text: unknown = Reflect.get(item, "text");
      if (typeof text === "string") events.agentText = text;
    }
  }
}

export class CodexExecSession implements ConsultantSession {
  #opts: ExecSessionOptions;
  #queue: Promise<unknown> = Promise.resolve();
  #interruptActive: (() => void) | undefined;
  #closed = false;
  #askCount = 0;
  lastLatencyMs: number | undefined;

  constructor(opts: ExecSessionOptions) {
    this.#opts = opts;
  }

  ask<T>(opts: ConsultantAskOptions<T>): Promise<Result<T, ConsultantError>> {
    const run = this.#queue.then(() => this.#run(opts));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async rateLimits(): Promise<Result<RateLimits, ConsultantError>> {
    return err({ kind: "process", message: "rate limits are only available with the app-server transport" });
  }

  async interrupt(): Promise<void> {
    this.#interruptActive?.();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#interruptActive?.();
    await this.#opts.onClose?.();
  }

  async #run<T>(opts: ConsultantAskOptions<T>): Promise<Result<T, ConsultantError>> {
    if (this.#closed) return err({ kind: "process", message: "the Codex session is closed" });
    if (opts.signal?.aborted) return err(stopError("cancelled", 0));
    const timeoutMs = opts.timeoutMs ?? this.#opts.defaultTimeoutMs;
    const dir = await mkdtemp(join(this.#opts.cwd, `ask-${++this.#askCount}-`));
    const schemaPath = join(dir, "schema.json");
    const outPath = join(dir, "last-message.txt");
    await writeFile(schemaPath, JSON.stringify(opts.schema));
    const args = execArgs({
      cwd: this.#opts.cwd,
      schemaPath,
      outPath,
      system: this.#opts.system,
      images: (opts.images ?? []).map((p) => (isAbsolute(p) ? p : resolve(p))),
      ...(this.#opts.model === undefined ? {} : { model: this.#opts.model }),
      ...(opts.effort === undefined ? {} : { effort: opts.effort }),
    });
    const watch = watchStop(timeoutMs, opts.signal);
    this.#interruptActive = () => watch.interrupt();
    const t0 = performance.now();
    try {
      const started = await startProcess(this.#opts.spawn, this.#opts.binary, args, {
        cwd: this.#opts.cwd,
        ...(this.#opts.env === undefined ? {} : { env: this.#opts.env }),
      });
      if (!started.ok) return started;
      const child = started.value;
      const stderrTail = collectTail(child.stderr);
      const events: ExecEvents = {};
      const lines = new LineDecoder();
      child.stdout?.on("data", (chunk: Uint8Array | string) => {
        for (const line of lines.push(chunk)) readExecEvent(events, line);
      });
      const exited = new Promise<{ code: number | null; signal: string | null }>((r) =>
        child.once("exit", (code, signal) => r({ code, signal })),
      );
      child.stdin?.on("error", () => {});
      child.stdin?.end(opts.prompt);

      const outcome = await Promise.race([exited, watch.stopped]);
      if (typeof outcome === "string") {
        child.kill("SIGTERM");
        const killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
        await exited;
        clearTimeout(killTimer);
        return err(stopError(outcome, timeoutMs));
      }
      for (const line of lines.end()) readExecEvent(events, line);
      this.lastLatencyMs = performance.now() - t0;
      if (outcome.code !== 0) {
        const message =
          events.failure ??
          events.lastError ??
          (stderrTail() || `codex exec exited with ${outcome.signal ?? outcome.code}`);
        return err({ kind: kindFromMessage(message), message: message.slice(0, 1000) });
      }
      let text = events.agentText;
      try {
        text = await readFile(outPath, "utf8");
      } catch {
        // Fall back to the last agent_message event.
      }
      return parseAnswer(text, opts.parse);
    } finally {
      watch.dispose();
      this.#interruptActive = undefined;
      await rm(dir, { recursive: true, force: true });
    }
  }
}
