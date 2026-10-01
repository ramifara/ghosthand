// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Replay v0 (mode A): re-executes recorded actions by stable fingerprint with zero decision calls,
// then re-runs the final checks. A missing target fails the replay (Jev healing lands in P1-11).
import { type Clock, type EventSink, evaluateDoneWhen, execute, systemClock } from "@ghosthand/core";
import type {
  Action,
  Computer,
  Element,
  RunOutcome,
  Snapshot,
  StepTiming,
  TaskSpec,
} from "@ghosthand/protocol";

export interface RecordedTarget {
  stableId: string;
  role: string;
  name: string;
  automationId?: string | undefined;
}

export interface ReplayStep {
  step: number;
  action: Action;
  target: RecordedTarget | null;
}

/** Finds the element a recorded action targeted: stableId, then automation id, then a unique role+name. */
export function matchTarget(snapshot: Snapshot, target: RecordedTarget): Element | undefined {
  const byStable = snapshot.elements.filter((e) => e.stableId === target.stableId);
  if (byStable.length === 1) return byStable[0];
  if (target.automationId) {
    const byId = snapshot.elements.filter((e) => e.automationId === target.automationId);
    if (byId.length === 1) return byId[0];
  }
  const byName = snapshot.elements.filter((e) => e.role === target.role && e.name === target.name);
  return byName.length === 1 ? byName[0] : undefined;
}

/** Rewrites token references in an action to the element found in the new snapshot. */
export function retarget(action: Action, element: Element): Action {
  return "token" in action ? ({ ...action, token: element.token } as Action) : action;
}

export interface ReplayDeps {
  computer: Computer;
  events: EventSink;
  clock?: Clock;
  oracle?: (taskId: string) => Promise<boolean | undefined>;
  settleCapMs?: number;
}

export interface ReplayResult {
  outcome: RunOutcome;
  reason: string;
  steps: number;
  wallMs: number;
  decisionCalls: 0;
}

export async function replayRun(
  task: TaskSpec,
  steps: ReplayStep[],
  deps: ReplayDeps,
): Promise<ReplayResult> {
  const clock = deps.clock ?? systemClock;
  const started = clock.now();
  const emit = deps.events.emit.bind(deps.events);
  let done = 0;
  const finish = (outcome: RunOutcome, reason: string): ReplayResult => {
    const wallMs = clock.now() - started;
    emit({
      type: "run.end",
      outcome,
      reason,
      steps: done,
      wallMs,
      costUsd: 0,
      decisionCalls: 0,
      modelCalls: 0,
      modeShares: done > 0 ? { A: 1 } : {},
    });
    return { outcome, reason, steps: done, wallMs, decisionCalls: 0 };
  };

  const opened = await deps.computer.open(task.startUrl);
  if (!opened.ok) return finish("error", `open failed: ${opened.error.message}`);

  for (const s of steps) {
    const timing: StepTiming = { settleMs: 0, observeMs: 0, decideMs: 0, actMs: 0, verifyMs: 0 };
    let t = clock.now();
    await deps.computer.waitIdle({ capMs: deps.settleCapMs ?? 5000 });
    timing.settleMs = clock.now() - t;
    t = clock.now();
    const observed = await deps.computer.observe();
    timing.observeMs = clock.now() - t;
    if (!observed.ok) return finish("error", `observe failed: ${observed.error.message}`);
    const snapshot = observed.value;
    done++;
    emit({
      type: "observe",
      step: done,
      snapshotId: snapshot.id,
      ...(snapshot.url ? { url: snapshot.url } : {}),
      elementCount: snapshot.elements.length,
      tokenEstimate: snapshot.tokenEstimate,
    });
    let action = s.action;
    if (s.target && "token" in action) {
      const el = matchTarget(snapshot, s.target);
      if (!el) {
        emit({
          type: "escalate",
          step: done,
          from: "A",
          to: "H",
          reason: `target not found: ${s.target.role} "${s.target.name}"`,
        });
        return finish(
          "failure",
          `replay target not found at step ${s.step}: ${s.target.role} "${s.target.name}"`,
        );
      }
      action = retarget(action, el);
    } else if ("token" in action) {
      return finish("failure", `recorded step ${s.step} has no target fingerprint`);
    }
    emit({ type: "action", step: done, action, ...(s.target ? { target: s.target } : {}), mode: "A" });
    t = clock.now();
    const result = await execute(deps.computer, action);
    timing.actMs = clock.now() - t;
    emit({ type: "effect", step: done, result });
    emit({ type: "step.end", step: done, timing, mode: "A" });
    if (result.effect === "refused")
      return finish("failure", `step ${s.step} refused: ${result.error?.message ?? "refused"}`);
  }

  // Final checks always re-run: every subgoal's deterministic done_when, then the oracle.
  await deps.computer.waitIdle({ capMs: deps.settleCapMs ?? 5000 });
  const final = await deps.computer.observe();
  if (!final.ok) return finish("error", `final observe failed: ${final.error.message}`);
  const predicates = (task.plan?.subgoals ?? []).flatMap((g) =>
    g.doneWhen.all.filter((p) => p.kind !== "model"),
  );
  const nones = (task.plan?.subgoals ?? []).flatMap((g) => g.doneWhen.none);
  if (predicates.length > 0 || nones.length > 0) {
    const r = await evaluateDoneWhen(
      { all: predicates, none: nones },
      final.value,
      deps.oracle ? { oracle: deps.oracle } : {},
    );
    emit({
      type: "verify",
      step: done,
      state: r.state,
      decidedBy: r.decidedBy === "decision" ? "none" : r.decidedBy,
      predicates: r.predicates.map(({ predicate, state }) => ({ predicate, state })),
    });
    if (r.state !== "satisfied") return finish("failure", "final done_when checks did not pass");
  }
  if (deps.oracle) {
    const pass = await deps.oracle(task.id);
    if (pass === false) return finish("failure", "oracle failed after replay");
  }
  return finish("success", `replayed ${done} actions with 0 decision calls`);
}
