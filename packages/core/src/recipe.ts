// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Recipes as the loop sees them (mode A): an ordered list of guarded steps with targets fingerprinted at
// learning time, bound to this task's parameters by the knowledge layer. Storage, induction and trust
// live in @ghosthand/knowledge; core only matches targets, heals one step with Jev and executes.
import type { Action, EffectClass, Element, Plan, Questions, Snapshot, TaskSpec } from "@ghosthand/protocol";
import { isActionable } from "./candidates.ts";
import { ANTI_INJECTION, describeElement, NONE } from "./questions.ts";

export interface RecordedTarget {
  stableId: string;
  role: string;
  name: string;
  automationId?: string | undefined;
}

export interface RecipeStep {
  /** The action; token fields are re-bound to the live element at replay. Values are already bound. */
  action: Action;
  target: RecordedTarget | null;
  /** A drag's drop zone. */
  destination?: RecordedTarget | undefined;
  /** The screen the step ran on when it was learned (guard and app-map key). */
  screen?: { key: string; urlPattern?: string | undefined };
  /** Effect class at learning time; commit steps replay only when the subgoal allows commit. */
  effect: EffectClass;
}

/** A recipe bound to one task: steps with parameter values substituted. */
export interface RecipeMatch {
  recipeId: string;
  version: number;
  intent: string;
  trust: number;
  steps: RecipeStep[];
  /** Parameter values bound from the instruction (names → values; secrets stay names). */
  params: Record<string, string>;
  /** The plan of the run the recipe was learned from (skips the planner). */
  plan?: Plan;
}

/** Looks up a verified recipe for a task on its start screen. Implemented by @ghosthand/knowledge. */
export interface RecipeBook {
  match(task: TaskSpec, start: Snapshot): RecipeMatch | undefined;
}

/** What happened in mode A, reported in RunResult so the knowledge layer can update trust and patch heals. */
export interface ReplayReport {
  recipeId: string;
  version: number;
  total: number;
  /** Steps executed in mode A (including healed ones). */
  replayed: number;
  heals: Array<{ index: number; target: RecordedTarget }>;
  /** Set when a guard failed and the run fell back to mode B at this step index. */
  fellBackAt?: number;
  reason?: string;
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
  if ("token" in action) return { ...action, token: element.token } as Action;
  if (action.type === "click" && "token" in action.target)
    return { ...action, target: { token: element.token } };
  if (action.type === "drag" && "token" in action.from) return { ...action, from: { token: element.token } };
  if (action.type === "scroll" && action.target && "token" in action.target)
    return { ...action, target: { token: element.token } };
  return action;
}

/** The token-bearing target of an action, if any (drag sources included). */
export function actionToken(action: Action): string | undefined {
  if ("token" in action) return action.token;
  if (action.type === "click" && "token" in action.target) return action.target.token;
  if (action.type === "drag" && "token" in action.from) return action.from.token;
  if (action.type === "scroll" && action.target && "token" in action.target) return action.target.token;
  return undefined;
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

export const describeStep = (s: RecipeStep): string =>
  s.target ? `${s.action.type} ${s.target.role} "${s.target.name}"` : s.action.type;
