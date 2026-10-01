// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Per-run human controls in the engine host: takeover pause/resume (core's RunControl), approvals with
// "once / for this task / deny", and stop. Pure (clock injected), so it is unit-tested without a run.
import type { ApprovalRequest, RunControl } from "@ghosthand/core";
import type { ApprovalDecision, ApprovalRequestView, RunStatus } from "@ghosthand/protocol";

export interface RunControllerEvents {
  status(status: RunStatus, detail?: string): void;
  approvalRequested(view: ApprovalRequestView): void;
  approvalResolved(requestId: string, decision: ApprovalDecision): void;
}

export function describeApproval(req: ApprovalRequest): string {
  const target = req.element ? `${req.element.role} "${req.element.name}"` : "(no target)";
  return `${req.action.type} ${target}`;
}

export function toApprovalView(requestId: string, req: ApprovalRequest): ApprovalRequestView {
  const el = req.element;
  const bounds = el ? (el.visibleBounds ?? el.bounds ?? undefined) : undefined;
  return {
    requestId,
    step: req.step,
    actionType: req.action.type,
    target: el
      ? {
          role: el.role,
          name: el.name,
          ...(el.context ? { context: el.context.slice(0, 200) } : {}),
          ...(bounds ? { bounds } : {}),
        }
      : null,
    effect: req.effect,
    goal: req.subgoal.goal,
    describe: describeApproval(req),
  };
}

export class RunController implements RunControl {
  readonly abort = new AbortController();
  readonly #events: RunControllerEvents;
  readonly #now: () => number;
  #paused: { since: number; resume: Promise<void>; release: () => void } | undefined;
  #approveAll = false;
  readonly #approvals = new Map<string, (granted: boolean) => void>();
  #nextApproval = 1;

  constructor(events: RunControllerEvents, now: () => number = Date.now) {
    this.#events = events;
    this.#now = now;
  }

  get paused(): boolean {
    return this.#paused !== undefined;
  }

  get stopped(): boolean {
    return this.abort.signal.aborted;
  }

  pause(): boolean {
    if (this.#paused || this.stopped) return false;
    let release!: () => void;
    const resume = new Promise<void>((r) => {
      release = r;
    });
    this.#paused = { since: this.#now(), resume, release };
    this.#events.status("paused", "taken over by the user");
    return true;
  }

  resume(): boolean {
    const p = this.#paused;
    if (!p) return false;
    this.#paused = undefined;
    p.release();
    if (!this.stopped) this.#events.status("running", "resumed");
    return true;
  }

  toggle(): void {
    if (this.paused) this.resume();
    else this.pause();
  }

  /** core RunControl: waits while paused; returns the paused milliseconds (0 when it did not wait). */
  async checkpoint(): Promise<number> {
    const p = this.#paused;
    if (!p || this.stopped) return 0;
    await Promise.race([
      p.resume,
      new Promise<void>((r) => this.abort.signal.addEventListener("abort", () => r(), { once: true })),
    ]);
    return Math.max(1, this.#now() - p.since);
  }

  /** core LoopDeps.approve. */
  approve = (req: ApprovalRequest): Promise<boolean> => {
    if (this.stopped) return Promise.resolve(false);
    const requestId = `a${this.#nextApproval++}`;
    if (this.#approveAll) {
      this.#events.approvalResolved(requestId, "task");
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      this.#approvals.set(requestId, resolve);
      this.#events.approvalRequested(toApprovalView(requestId, req));
    });
  };

  respond(requestId: string, decision: ApprovalDecision): boolean {
    const resolve = this.#approvals.get(requestId);
    if (!resolve) return false;
    this.#approvals.delete(requestId);
    if (decision === "task") this.#approveAll = true;
    this.#events.approvalResolved(requestId, decision);
    resolve(decision !== "deny");
    return true;
  }

  stop(): void {
    if (this.stopped) return;
    this.abort.abort();
    for (const id of [...this.#approvals.keys()]) this.respond(id, "deny");
    this.resume();
    this.#events.status("stopping", "stopped by the user");
  }
}
