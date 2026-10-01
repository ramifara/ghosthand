// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Mode A (research note §1.4, §2.3): replay a bound recipe step by step with guards. Each step must find
// its target (stable id, test id, or a unique role+name); on a miss, one Jev "same control?" question
// repairs that step (heal). A failed heal, a refused action, a forbidden target or a commit the subgoal
// does not allow ends the replay, and the loop continues in mode B from the current screen.
// Final checks are never skipped: the loop evaluates every subgoal's done_when after the replay.
import type {
  Action,
  Computer,
  DecisionProvider,
  EffectClass,
  Element,
  StepTiming,
  TaskSpec,
} from "@ghosthand/protocol";
import { type ForbiddenRule, matchForbidden } from "./effect-rules.ts";
import type { EventSink } from "./event-sink.ts";
import { choiceConfidence } from "./gates.ts";
import type { Clock } from "./logger.ts";
import { NONE } from "./questions.ts";
import {
  actionToken,
  describeStep,
  HEAL_THRESHOLD,
  healCandidates,
  healQuestion,
  matchTarget,
  type RecipeMatch,
  type RecordedTarget,
  type ReplayReport,
  retarget,
} from "./recipe.ts";
import { screenFingerprint } from "./screen-fingerprint.ts";
import type { SecretsRegistry } from "./secrets.ts";
import { buildState } from "./state-builder.ts";

export interface ModeAEnv {
  computer: Computer;
  events: EventSink;
  decision: DecisionProvider;
  secrets: SecretsRegistry;
  clock: Clock;
  task: TaskSpec;
  forbidden: ForbiddenRule[];
  /** Effects the plan allows anywhere; commit steps need "commit". */
  allowedEffects: readonly EffectClass[];
  settleCapMs: number;
  /** First step number to use (steps continue the run's numbering). */
  firstStep: number;
  signal?: AbortSignal;
  onDecision: (costUsd: number) => void;
}

export interface ModeAResult {
  report: ReplayReport;
  /** Steps used (each replayed or attempted step counts). */
  steps: number;
  timings: StepTiming[];
  /** Steps per mode: A for replayed, B for healed (Jev chose the target). */
  modeSteps: { A: number; B: number };
}

/** Executes one action through the Computer (same mapping as the loop). */
export type Execute = (computer: Computer, action: Action) => ReturnType<Computer["press"]>;

export async function runModeA(match: RecipeMatch, env: ModeAEnv, execute: Execute): Promise<ModeAResult> {
  const { computer, events, clock } = env;
  const report: ReplayReport = {
    recipeId: match.recipeId,
    version: match.version,
    total: match.steps.length,
    replayed: 0,
    heals: [],
  };
  const timings: StepTiming[] = [];
  const modeSteps = { A: 0, B: 0 };
  let step = env.firstStep - 1;
  const fallBack = (index: number, reason: string): ModeAResult => {
    report.fellBackAt = index;
    report.reason = reason;
    events.emit({ type: "escalate", step: Math.max(step, 1), from: "A", to: "B", reason, direction: "up" });
    return { report, steps: step - env.firstStep + 1, timings, modeSteps };
  };

  for (const [index, s] of match.steps.entries()) {
    if (env.signal?.aborted) return fallBack(index, "aborted");
    step++;
    const timing: StepTiming = { settleMs: 0, observeMs: 0, decideMs: 0, actMs: 0, verifyMs: 0 };
    let t = clock.now();
    await computer.waitIdle({ capMs: env.settleCapMs });
    timing.settleMs = clock.now() - t;
    t = clock.now();
    const observed = await computer.observe();
    timing.observeMs = clock.now() - t;
    if (!observed.ok) return fallBack(index, `observe failed: ${observed.error.message}`);
    const snapshot = observed.value;
    const fp = screenFingerprint(snapshot);
    events.emit({
      type: "observe",
      step,
      snapshotId: snapshot.id,
      ...(snapshot.url ? { url: snapshot.url } : {}),
      elementCount: snapshot.elements.length,
      tokenEstimate: snapshot.tokenEstimate,
      screen: fp.key,
      quality: snapshot.quality.score,
    });

    let action = s.action;
    let element: Element | undefined;
    let healed = false;
    if (s.target && actionToken(action) !== undefined) {
      element = matchTarget(snapshot, s.target);
      if (!element) {
        t = clock.now();
        element = await heal(s.target, snapshot, step, env);
        timing.decideMs = clock.now() - t;
        if (!element) {
          timings.push(timing);
          return fallBack(index, `guard: ${describeStep(s)} not found on this screen; heal failed`);
        }
        healed = true;
        report.heals.push({
          index,
          target: {
            stableId: element.stableId,
            role: element.role,
            name: element.name,
            ...(element.automationId ? { automationId: element.automationId } : {}),
          },
        });
        events.emit({
          type: "escalate",
          step,
          from: "A",
          to: "B",
          reason: `healed step ${index + 1}: ${s.target.role} "${s.target.name}" → "${element.name}"`,
          direction: "up",
        });
      }
      action = retarget(action, element);
      if (action.type === "drag" && "token" in action.to) {
        const drop = s.destination ? matchTarget(snapshot, s.destination) : undefined;
        if (!drop) {
          timings.push(timing);
          return fallBack(index, `guard: the drop zone of ${describeStep(s)} is not on this screen`);
        }
        action = { ...action, to: { token: drop.token } };
      }
    } else if (actionToken(action) !== undefined) {
      timings.push(timing);
      return fallBack(index, `guard: step ${index + 1} has no target fingerprint`);
    }
    if (element) {
      const hit = matchForbidden(element, env.forbidden);
      if (hit) {
        timings.push(timing);
        return fallBack(index, `guard: ${describeStep(s)} matches forbidden "${hit}"`);
      }
    }
    if (s.effect === "commit" && !env.allowedEffects.includes("commit")) {
      timings.push(timing);
      return fallBack(index, `guard: ${describeStep(s)} commits and the task does not allow commits`);
    }
    if (s.effect === "forbidden") {
      timings.push(timing);
      return fallBack(index, `guard: ${describeStep(s)} was classed forbidden`);
    }
    const mode = healed ? "B" : "A";
    events.emit({
      type: "action",
      step,
      action,
      effectClass: s.effect,
      ...(s.target
        ? {
            target: element
              ? {
                  stableId: element.stableId,
                  role: element.role,
                  name: element.name,
                  ...(element.automationId ? { automationId: element.automationId } : {}),
                }
              : s.target,
          }
        : {}),
      mode,
    });
    t = clock.now();
    const result = await execute(computer, action);
    timing.actMs = clock.now() - t;
    events.emit({ type: "effect", step, result });
    events.emit({ type: "step.end", step, timing, mode });
    timings.push(timing);
    modeSteps[mode]++;
    report.replayed++;
    if (result.effect === "refused")
      return fallBack(index + 1, `step ${index + 1} refused: ${result.error?.message ?? "refused"}`);
  }
  return { report, steps: step - env.firstStep + 1, timings, modeSteps };
}

async function heal(
  target: RecordedTarget,
  snapshot: Parameters<typeof healCandidates>[0],
  step: number,
  env: ModeAEnv,
): Promise<Element | undefined> {
  const candidates = healCandidates(snapshot, target);
  if (candidates.length === 0) return undefined;
  const questions = healQuestion(target, candidates);
  const state = buildState(
    {
      instruction: env.task.instruction,
      goal: `Find the control previously named ${JSON.stringify(target.name)}`,
      step,
      phase: "act",
      snapshot,
      elements: candidates,
      history: [],
      inputs: env.task.secrets,
    },
    env.secrets,
  );
  env.events.emit({
    type: "decision.request",
    step,
    purpose: "replay",
    questions,
    stateTokens: Math.ceil(JSON.stringify(state).length / 3),
  });
  const r = await env.decision.ask(state, questions, env.signal ? { signal: env.signal } : {});
  if (!r.ok) {
    env.onDecision(0);
    env.events.emit({
      type: "decision.answer",
      step,
      error: r.error,
      model: env.decision.id,
      latencyMs: 0,
      costUsd: 0,
      inputTokens: 0,
    });
    return undefined;
  }
  env.onDecision(r.value.costUsd);
  env.events.emit({
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
  if (a?.type !== "choice" || a.choice === NONE || choiceConfidence(a) < HEAL_THRESHOLD) return undefined;
  return candidates.find((e) => e.token === a.choice);
}
