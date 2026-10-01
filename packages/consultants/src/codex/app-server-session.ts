// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A warm Codex consultant session: one app-server process, one ephemeral read-only thread, one turn per ask.
import { access } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type {
  ConsultantAskOptions,
  ConsultantError,
  ConsultantSession,
  RateLimits,
  Result,
} from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import { readRateLimits } from "./account.ts";
import { parseAnswer } from "./answer.ts";
import type { AppServerConnection } from "./app-server-connection.ts";
import type { ThreadItem, Turn, TurnError } from "./app-server-protocol.ts";
import {
  EmptyResult,
  ErrorNotificationParams,
  ItemCompletedParams,
  ThreadStartResult,
  TurnCompletedParams,
  TurnStartResult,
} from "./app-server-protocol.ts";
import { fromTurnError } from "./errors.ts";
import type { StopReason, StopWatch } from "./stop-watch.ts";
import { stopError, watchStop } from "./stop-watch.ts";

export interface CodexTurnStats {
  turnId: string;
  status: Turn["status"];
  /** From sending `turn/start` to `turn/completed`, measured here. */
  latencyMs: number;
  /** As reported by Codex. */
  durationMs?: number;
}

export interface CodexSessionInfo {
  threadId: string;
  model: string;
  reasoningEffort?: string;
  spawnToInitializedMs: number;
  threadStartMs: number;
  version?: string;
}

export interface OpenThreadOptions {
  system: string;
  model?: string;
  cwd: string;
  defaultTimeoutMs: number;
  onClose?: () => Promise<void>;
}

interface ActiveTurn {
  turnId?: string;
  watch: StopWatch;
}

/** Waits at most this long for `turn/completed` after sending `turn/interrupt`. */
const INTERRUPT_GRACE_MS = 3000;

async function checkImages(images: readonly string[]): Promise<Result<string[], ConsultantError>> {
  const paths = images.map((p) => (isAbsolute(p) ? p : resolve(p)));
  for (const p of paths) {
    try {
      await access(p);
    } catch {
      return err({ kind: "process", message: `image not found: ${p}` });
    }
  }
  return ok(paths);
}

function finalMessage(items: readonly ThreadItem[]): string | undefined {
  const messages = items.filter((i) => i.type === "agentMessage" && typeof i.text === "string");
  const final = messages.findLast((i) => i.phase === "final_answer") ?? messages.at(-1);
  return final?.text;
}

export class CodexAppServerSession implements ConsultantSession {
  readonly info: CodexSessionInfo;
  #conn: AppServerConnection;
  #cwd: string;
  #defaultTimeoutMs: number;
  #onClose: (() => Promise<void>) | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #active: ActiveTurn | undefined;
  #lastTurn: CodexTurnStats | undefined;
  #closed = false;

  private constructor(conn: AppServerConnection, info: CodexSessionInfo, opts: OpenThreadOptions) {
    this.#conn = conn;
    this.info = info;
    this.#cwd = opts.cwd;
    this.#defaultTimeoutMs = opts.defaultTimeoutMs;
    this.#onClose = opts.onClose;
  }

  /** Starts an ephemeral thread that can read but never write, run commands with approval, or ask the user. */
  static async open(
    conn: AppServerConnection,
    opts: OpenThreadOptions,
  ): Promise<Result<CodexAppServerSession, ConsultantError>> {
    const t0 = performance.now();
    const r = await conn.request(
      "thread/start",
      {
        ephemeral: true,
        sandbox: "read-only",
        approvalPolicy: "never",
        cwd: opts.cwd,
        developerInstructions: opts.system,
        ...(opts.model === undefined ? {} : { model: opts.model }),
      },
      ThreadStartResult,
    );
    if (!r.ok) return r;
    return ok(
      new CodexAppServerSession(
        conn,
        {
          threadId: r.value.thread.id,
          model: r.value.model,
          ...(r.value.reasoningEffort ? { reasoningEffort: r.value.reasoningEffort } : {}),
          spawnToInitializedMs: conn.spawnToInitializedMs,
          threadStartMs: performance.now() - t0,
          ...(conn.version === undefined ? {} : { version: conn.version }),
        },
        opts,
      ),
    );
  }

  get lastTurn(): CodexTurnStats | undefined {
    return this.#lastTurn;
  }

  get cwd(): string {
    return this.#cwd;
  }

  ask<T>(opts: ConsultantAskOptions<T>): Promise<Result<T, ConsultantError>> {
    const run = this.#queue.then(() => this.#runTurn(opts));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async rateLimits(): Promise<Result<RateLimits, ConsultantError>> {
    const r = await readRateLimits(this.#conn);
    return r.ok ? ok(r.value.limits) : r;
  }

  async interrupt(): Promise<void> {
    this.#active?.watch.interrupt();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#active?.watch.interrupt();
    await this.#conn.close();
    await this.#onClose?.();
  }

  async #runTurn<T>(opts: ConsultantAskOptions<T>): Promise<Result<T, ConsultantError>> {
    if (this.#closed || this.#conn.closed) {
      return err({ kind: "process", message: "the Codex session is closed" });
    }
    if (opts.signal?.aborted) return err(stopError("cancelled", 0));
    const images = await checkImages(opts.images ?? []);
    if (!images.ok) return images;

    const timeoutMs = opts.timeoutMs ?? this.#defaultTimeoutMs;
    const watch = watchStop(timeoutMs, opts.signal);
    const active: ActiveTurn = { watch };
    this.#active = active;
    const { threadId } = this.info;

    const items: ThreadItem[] = [];
    let lastError: TurnError | undefined;
    let completeTurn: (turn: Turn) => void = () => {};
    const completed = new Promise<Turn>((r) => {
      completeTurn = r;
    });
    const buffered: Array<[string, unknown]> = [];
    const handle = (method: string, params: unknown): void => {
      if (method === "item/completed") {
        const p = ItemCompletedParams.safeParse(params);
        if (p.success && p.data.threadId === threadId && p.data.turnId === active.turnId)
          items.push(p.data.item);
      } else if (method === "error") {
        const p = ErrorNotificationParams.safeParse(params);
        if (p.success && p.data.turnId === active.turnId && !p.data.willRetry) lastError = p.data.error;
      } else if (method === "turn/completed") {
        const p = TurnCompletedParams.safeParse(params);
        if (p.success && p.data.threadId === threadId && p.data.turn.id === active.turnId)
          completeTurn(p.data.turn);
      }
    };
    const unsubscribe = this.#conn.onNotification((method, params) => {
      if (active.turnId === undefined) buffered.push([method, params]);
      else handle(method, params);
    });
    let closedReason: string | undefined;
    const closed = new Promise<"closed">((r) => {
      const off = this.#conn.client.onClose((reason) => {
        closedReason = reason;
        off();
        r("closed");
      });
      void completed.finally(off);
    });

    const t0 = performance.now();
    try {
      const startP = this.#conn.request(
        "turn/start",
        {
          threadId,
          input: [
            { type: "text", text: opts.prompt, text_elements: [] },
            ...images.value.map((path) => ({ type: "localImage", path })),
          ],
          outputSchema: opts.schema,
          approvalPolicy: "never",
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          ...(opts.effort === undefined ? {} : { effort: opts.effort }),
        },
        TurnStartResult,
        { timeoutMs },
      );
      const first = await Promise.race([startP, watch.stopped]);
      if (typeof first === "string") {
        // The turn may still start; interrupt it as soon as we learn its id.
        void startP.then((r) => {
          if (r.ok) void this.#sendInterrupt(r.value.turn.id);
        });
        return err(stopError(first, timeoutMs));
      }
      if (!first.ok) return first;
      active.turnId = first.value.turn.id;
      for (const [m, p] of buffered.splice(0)) handle(m, p);

      const outcome: Turn | StopReason | "closed" = await Promise.race([completed, watch.stopped, closed]);
      if (outcome === "closed") {
        return err({ kind: "process", message: closedReason ?? "codex app-server closed" });
      }
      if (typeof outcome === "string") {
        await this.#sendInterrupt(active.turnId);
        const settled = await Promise.race([
          completed,
          new Promise<undefined>((r) => setTimeout(() => r(undefined), INTERRUPT_GRACE_MS).unref()),
        ]);
        if (settled) this.#record(settled, t0);
        return err(stopError(outcome, timeoutMs));
      }
      this.#record(outcome, t0);
      if (outcome.status === "failed") {
        return err(fromTurnError(outcome.error ?? lastError ?? { message: "the turn failed" }));
      }
      if (outcome.status === "interrupted") {
        return err({ kind: "cancelled", message: "the turn was interrupted by Codex" });
      }
      return parseAnswer(finalMessage(items) ?? finalMessage(outcome.items ?? []), opts.parse);
    } finally {
      watch.dispose();
      unsubscribe();
      completeTurn({ id: "", status: "interrupted" });
      if (this.#active === active) this.#active = undefined;
    }
  }

  #record(turn: Turn, t0: number): void {
    this.#lastTurn = {
      turnId: turn.id,
      status: turn.status,
      latencyMs: performance.now() - t0,
      ...(turn.durationMs == null ? {} : { durationMs: turn.durationMs }),
    };
  }

  async #sendInterrupt(turnId: string): Promise<void> {
    if (this.#conn.closed) return;
    await this.#conn.request("turn/interrupt", { threadId: this.info.threadId, turnId }, EmptyResult, {
      timeoutMs: INTERRUPT_GRACE_MS,
    });
  }
}
