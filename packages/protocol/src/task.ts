// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { z } from "zod";

export const Mode = z.enum(["do", "extract", "fill", "test", "monitor"]);
export type Mode = z.infer<typeof Mode>;

/** Consequence class of an action. "commit" needs permission; "forbidden" is never executed. */
export const EffectClass = z.enum(["advance", "commit", "forbidden"]);
export type EffectClass = z.infer<typeof EffectClass>;

/** A deterministic or model-checked condition. Deterministic kinds always override model verdicts. */
export const Predicate = z.discriminatedUnion("kind", [
  /** URL matches: a path ("/profile"), a full URL, or a /regex/. */
  z.object({ kind: z.literal("url"), matches: z.string().min(1) }),
  /** An element with this role (optional) and accessible name is visible. */
  z.object({ kind: z.literal("visible"), name: z.string().min(1), role: z.string().optional() }),
  /** Text appears in the page text or an element name. */
  z.object({ kind: z.literal("text"), text: z.string().min(1) }),
  /** A field (by accessible name) has this redacted value. */
  z.object({ kind: z.literal("value"), name: z.string().min(1), value: z.string() }),
  /** An HTTP check (API or DB-backed endpoint), evaluated by the engine, never by the page. */
  z.object({
    kind: z.literal("http"),
    method: z.enum(["GET", "HEAD"]).default("GET"),
    url: z.string().min(1),
    status: z.number().int().optional(),
    /** Dot path into a JSON body (e.g. "user.name"), compared with `equals`. */
    path: z.string().optional(),
    equals: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  }),
  /** A testbed oracle (control API) passes. */
  z.object({ kind: z.literal("oracle"), taskId: z.string().min(1) }),
  /** Ask the decision model; used only when no deterministic check applies. */
  z.object({ kind: z.literal("model"), criteria: z.string().min(1) }),
]);
export type Predicate = z.infer<typeof Predicate>;

export const DoneWhen = z.object({
  /** All must hold. */
  all: z.array(Predicate).default([]),
  /** None may hold (e.g. an error message). */
  none: z.array(Predicate).default([]),
});
export type DoneWhen = z.infer<typeof DoneWhen>;

export const Budget = z.object({
  steps: z.number().int().positive(),
  seconds: z.number().positive(),
  usd: z.number().nonnegative(),
});
export type Budget = z.infer<typeof Budget>;

export const DEFAULT_BUDGET: Budget = { steps: 25, seconds: 180, usd: 0.25 };

export const Subgoal = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  doneWhen: DoneWhen,
  allowedEffects: z.array(EffectClass).default(["advance"]),
  maxSteps: z.number().int().positive().default(15),
  /** Element names the planner expects to be relevant; boosts ranking only. */
  seedTargets: z.array(z.string()).default([]),
});
export type Subgoal = z.infer<typeof Subgoal>;

export const Plan = z.object({
  subgoals: z.array(Subgoal).min(1).max(12),
  source: z.enum(["task", "planner", "recipe"]),
});
export type Plan = z.infer<typeof Plan>;

export const TaskSpec = z.object({
  /** Testbed task id, or "adhoc". */
  id: z.string().min(1),
  mode: Mode.default("do"),
  instruction: z.string().min(1),
  startUrl: z.string().min(1),
  allowOrigins: z.array(z.string()).default([]),
  plan: Plan.optional(),
  budget: Budget.default(DEFAULT_BUDGET),
  /** Secret names the agent may use, mapped to field hints for the model. */
  secrets: z.array(z.string()).default([]),
  /** Forbidden outcomes, phrased for the effect gate (e.g. "delete any order"). */
  forbidden: z.array(z.string()).default([]),
});
export type TaskSpec = z.infer<typeof TaskSpec>;
export type TaskSpecInput = z.input<typeof TaskSpec>;
