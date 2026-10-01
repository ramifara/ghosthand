// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Long runs return a job id at once; callers poll `get_run`. Jobs run one at a time (one browser profile,
// one testbed) in arrival order. State lives in memory for the server's lifetime.
import { randomBytes } from "node:crypto";

export type JobKind = "task" | "spec";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Job<R = unknown> {
  id: string;
  kind: JobKind;
  status: JobStatus;
  /** What was asked, for listings. */
  label: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Recent progress lines (last 50). */
  progress: string[];
  result?: R;
  error?: string;
}

export type JobRunner<R> = (ctx: {
  signal: AbortSignal;
  progress: (line: string) => void;
}) => Promise<{ ok: true; value: R } | { ok: false; error: string }>;

export const MAX_PROGRESS_LINES = 50;

export class JobRegistry {
  readonly #jobs = new Map<string, Job>();
  readonly #controllers = new Map<string, AbortController>();
  #tail: Promise<void> = Promise.resolve();
  readonly #now: () => Date;
  readonly #onProgress: ((job: Job, line: string) => void) | undefined;

  constructor(opts: { now?: () => Date; onProgress?: (job: Job, line: string) => void } = {}) {
    this.#now = opts.now ?? (() => new Date());
    this.#onProgress = opts.onProgress;
  }

  submit<R>(kind: JobKind, label: string, run: JobRunner<R>): Job<R> {
    const id = `job-${randomBytes(4).toString("hex")}`;
    const job: Job<R> = {
      id,
      kind,
      status: "queued",
      label,
      createdAt: this.#now().toISOString(),
      progress: [],
    };
    this.#jobs.set(id, job as Job);
    const controller = new AbortController();
    this.#controllers.set(id, controller);
    const progress = (line: string) => {
      job.progress.push(line);
      if (job.progress.length > MAX_PROGRESS_LINES)
        job.progress.splice(0, job.progress.length - MAX_PROGRESS_LINES);
      this.#onProgress?.(job as Job, line);
    };
    this.#tail = this.#tail.then(async () => {
      if (controller.signal.aborted) {
        job.status = "cancelled";
        job.finishedAt = this.#now().toISOString();
        return;
      }
      job.status = "running";
      job.startedAt = this.#now().toISOString();
      try {
        const r = await run({ signal: controller.signal, progress });
        if (r.ok) {
          job.status = controller.signal.aborted ? "cancelled" : "done";
          job.result = r.value;
        } else {
          job.status = controller.signal.aborted ? "cancelled" : "failed";
          job.error = r.error;
        }
      } catch (e) {
        job.status = "failed";
        job.error = e instanceof Error ? e.message : String(e);
      } finally {
        job.finishedAt = this.#now().toISOString();
        this.#controllers.delete(id);
      }
    });
    return job;
  }

  get(id: string): Job | undefined {
    return this.#jobs.get(id);
  }

  list(): Job[] {
    return [...this.#jobs.values()];
  }

  cancel(id: string): boolean {
    const c = this.#controllers.get(id);
    if (!c) return false;
    c.abort();
    return true;
  }

  /** Resolves when every submitted job has finished. */
  idle(): Promise<void> {
    return this.#tail;
  }
}
