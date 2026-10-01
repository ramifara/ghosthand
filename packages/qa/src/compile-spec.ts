// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Oracle compiler v2: every expect line becomes a loop predicate (core's compileExpectation), a QA-only
// deterministic check (qa-checks.ts) or a vision criterion (visual steps). Each case becomes one TaskSpec
// whose plan has one subgoal per step: goal = the perform text, doneWhen = the step's compiled expects.
import { compileExpectation } from "@ghosthand/core";
import { type DoneWhen, type Predicate, type Subgoal, TaskSpec } from "@ghosthand/protocol";
import { type CasePreflight, isDecisiveFlag, quotedCount } from "./preflight.ts";
import { parseQaCheck, type QaCheck } from "./qa-checks.ts";
import type { QaCase, QaExpect, QaSpec, StepFlag } from "./spec-schema.ts";

export type CompiledQaExpect =
  /** Evaluated inside the loop (done_when): url/visible/text/value/oracle/model. */
  | { kind: "loop"; source: string; line: number; predicate: Predicate; negated: boolean }
  /** Evaluated by the QA judge on the step-end snapshot or the driver's error log. */
  | { kind: "qa"; source: string; line: number; check: QaCheck; negated: boolean }
  /** HTTP/API checks run by the QA judge after the step (the loop has no HTTP checker). */
  | {
      kind: "http";
      source: string;
      line: number;
      predicate: Extract<Predicate, { kind: "http" }>;
      negated: boolean;
    }
  /** Visual steps: judged by the vision reviewer on the step-end screenshot. */
  | { kind: "vision"; source: string; line: number; criteria: string };

export interface CompiledStep {
  index: number;
  subgoalId: string;
  perform: string;
  flag: StepFlag;
  decisive: boolean;
  expects: CompiledQaExpect[];
  doneWhen: DoneWhen;
  /** True when doneWhen only asks "was the perform text done" (no step expectation reached the loop). */
  performOnly: boolean;
  maxSteps: number;
}

export interface CompiledCase {
  task: TaskSpec;
  steps: CompiledStep[];
  /** Case-level expects, judged after the last step. */
  expects: CompiledQaExpect[];
}

export function compileQaExpect(e: QaExpect, flag: StepFlag = "ok"): CompiledQaExpect {
  const qa = parseQaCheck(e.text);
  if (qa) return { kind: "qa", source: e.text, line: e.line, check: qa.check, negated: qa.negated };
  const c = compileExpectation(e.text);
  if (c.predicate.kind === "http")
    return { kind: "http", source: c.source, line: e.line, predicate: c.predicate, negated: c.negated };
  if (flag === "visual" && c.predicate.kind === "model")
    return { kind: "vision", source: c.source, line: e.line, criteria: c.source };
  return { kind: "loop", source: c.source, line: e.line, predicate: c.predicate, negated: c.negated };
}

/** The loop's done_when for a step. Advisory steps only wait for the action itself. */
export function stepDoneWhen(perform: string, flag: StepFlag, expects: CompiledQaExpect[]): DoneWhen {
  const all: Predicate[] = [];
  const none: Predicate[] = [];
  if (isDecisiveFlag(flag)) {
    for (const e of expects) {
      if (e.kind !== "loop") continue;
      if (e.negated && e.predicate.kind !== "model") none.push(e.predicate);
      else if (e.negated) all.push({ kind: "model", criteria: e.source });
      else all.push(e.predicate);
    }
  }
  if (all.length === 0) all.push({ kind: "model", criteria: perform });
  return { all, none };
}

export const MAX_SUBGOAL_STEPS = 15;

export function compileCase(
  spec: QaSpec,
  qaCase: QaCase,
  caseId: string,
  preflight?: CasePreflight,
): CompiledCase {
  const fm = spec.frontMatter;
  const steps: CompiledStep[] = qaCase.steps.map((s, i) => {
    const pre = preflight?.steps[i];
    const flag: StepFlag = pre?.flag ?? "ok";
    const expects = s.expects.map((e) => compileQaExpect(e, flag));
    const doneWhen = stepDoneWhen(s.perform, flag, expects);
    const actions = pre?.actions ?? quotedCount(s.perform);
    const only = doneWhen.all.length === 1 ? doneWhen.all[0] : undefined;
    const performOnly = only?.kind === "model" && only.criteria === s.perform && doneWhen.none.length === 0;
    return {
      index: s.index,
      subgoalId: `step-${s.index}`,
      perform: s.perform,
      flag,
      decisive: isDecisiveFlag(flag),
      expects,
      doneWhen,
      performOnly,
      // Two tries per named element plus room to settle and confirm.
      maxSteps: Math.min(MAX_SUBGOAL_STEPS, actions * 2 + 3),
    };
  });
  const subgoals: Subgoal[] = steps.map((s) => ({
    id: s.subgoalId,
    goal: s.perform,
    doneWhen: s.doneWhen,
    allowedEffects: [...fm.effects],
    maxSteps: s.maxSteps,
    seedTargets: [],
  }));
  const origin = new URL(fm.url).origin;
  // Least privilege: a case gets only the secrets its steps name; with none named, every listed secret.
  const named = fm.secrets.filter((n) => qaCase.steps.some((s) => s.perform.includes(`[input:${n}]`)));
  const secrets = named.length > 0 ? named : fm.secrets;
  const task = TaskSpec.parse({
    id: caseId,
    mode: "test",
    // The title is not quoted: quoted text in the instruction becomes a typing option.
    instruction: `QA case: ${qaCase.title}. Steps: ${qaCase.steps.map((s) => `${s.index}. ${s.perform}`).join(" ")}`,
    startUrl: fm.url,
    allowOrigins: [...new Set([origin, ...fm.allow_origins])],
    plan: { source: "task", subgoals },
    budget: fm.budget,
    secrets,
    forbidden: [],
  });
  return { task, steps, expects: qaCase.expects.map((e) => compileQaExpect(e)) };
}
