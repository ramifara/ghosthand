// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Replay (mode A): re-executes recorded actions by stable fingerprint with zero decision calls.
// When a fingerprint no longer resolves, one Jev "same control?" question re-grounds that step (heal).
// Final checks always re-run.
import {
  ANTI_INJECTION,
  buildState,
  type Clock,
  choiceConfidence,
  describeElement,
  type EventSink,
  evaluateDoneWhen,
  execute,
  isActionable,
  NONE,
  systemClock,
} from "@ghosthand/core";
import type {
  Action,
  Computer,
  DecisionProvider,
  Element,
  Questions,
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

export const HEAL_THRESHOLD = 0.7;

/** The single Jev question used to re-ground a recorded target on a changed page. */
export function healQuestion(target: RecordedTarget, candidates: Element[]): Questions {
  const criteria: Record<string, string> = {};
  for (const el of candidates.slice(0, 254)) criteria[el.token] = describeElement(el);
  criteria[NONE] = "None of these is the same control.";
  return {
    same_control: {
      type: "choice",
      instructions: `A recorded step acted on the ${target.role} named ${JSON.stringify(target.name)}${
        target.automationId ? ` (test id ${JSON.stringify(target.automationId)})` : ""
      }. The page changed. Which listed element is the same control, serving the same purpose? ${ANTI_INJECTION}`,
      criteria,
    },
  };
}

/** Candidates for healing: actionable elements, same role first. */
export function healCandidates(snapshot: Snapshot, target: RecordedTarget): Element[] {
  const pool = snapshot.elements.filter(isActionable);
  return [...pool.filter((e) => e.role === target.role), ...pool.filter((e) => e.role !== target.role)];
}

export interface ReplayDeps {
  computer: Computer;
  events: EventSink;
  /** Enables healing; without it a missing target fails the replay. */
  decision?: DecisionProvider;
  clock?: Clock;
  oracle?: (taskId: string) => Promise<boolean | undefined>;
  settleCapMs?: number;
}

export interface ReplayResult {
  outcome: RunOutcome;
  reason: string;
  steps: number;
  wallMs: number;
  decisionCalls: number;
  /** Steps whose target was re-grounded by Jev. */
  heals: number;
  costUsd: number;
}

async function heal(
  snapshot: Snapshot,
  target: RecordedTarget,
  step: number,
  task: TaskSpec,
  deps: ReplayDeps,
): Promise<{ element: Element | undefined; costUsd: number }> {
  const decision = deps.decision;
  if (!decision) return { element: undefined, costUsd: 0 };
  const candidates = healCandidates(snapshot, target);
  if (candidates.length === 0) return { element: undefined, costUsd: 0 };
  const questions = healQuestion(target, candidates);
  const state = buildState({
    instruction: task.instruction,
    goal: `Find the control previously named ${JSON.stringify(target.name)}`,
    step,
    phase: "act",
    snapshot,
    elements: candidates,
    history: [],
    inputs: [],
  });
  deps.events.emit({
    type: "decision.request",
    step,
    purpose: "replay",
    questions,
    stateTokens: Math.ceil(JSON.stringify(state).length / 3),
  });
  const r = await decision.ask(state, questions);
  if (!r.ok) {
    deps.events.emit({
      type: "decision.answer",
      step,
      error: r.error,
      model: decision.id,
      latencyMs: 0,
      costUsd: 0,
      inputTokens: 0,
    });
    return { element: undefined, costUsd: 0 };
  }
  deps.events.emit({
    type: "decision.answer",
    step,
    answers: r.value.answers,
    model: r.value.model,
    ...(r.value.requestId ? { requestId: r.value.requestId } : {}),
    latencyMs: r.value.latencyMs,
    costUsd: r.value.costUsd,
    inputTokens: r.value.usage.inputTokens,
  });
  const a = r.value.answers.same_control;
  if (a?.type !== "choice" || a.choice === NONE || choiceConfidence(a) < HEAL_THRESHOLD) {
    return { element: undefined, costUsd: r.value.costUsd };
  }
  return { element: candidates.find((e) => e.token === a.choice), costUsd: r.value.costUsd };
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
  let decisionCalls = 0;
  let heals = 0;
  let costUsd = 0;
  let healedSteps = 0;
  const finish = (outcome: RunOutcome, reason: string): ReplayResult => {
    const wallMs = clock.now() - started;
    emit({
      type: "run.end",
      outcome,
      reason,
      steps: done,
      wallMs,
      costUsd,
      decisionCalls,
      modelCalls: 0,
      modeShares:
        done > 0
          ? { A: (done - healedSteps) / done, ...(healedSteps > 0 ? { B: healedSteps / done } : {}) }
          : {},
    });
    return { outcome, reason, steps: done, wallMs, decisionCalls, heals, costUsd };
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
      let el = matchTarget(snapshot, s.target);
      if (!el && deps.decision) {
        const healed = await heal(snapshot, s.target, done, task, deps);
        decisionCalls++;
        costUsd += healed.costUsd;
        if (healed.element) {
          el = healed.element;
          heals++;
          healedSteps++;
          emit({
            type: "escalate",
            step: done,
            from: "A",
            to: "B",
            reason: `healed: ${s.target.role} "${s.target.name}" → "${el.name}"`,
          });
        }
      }
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
