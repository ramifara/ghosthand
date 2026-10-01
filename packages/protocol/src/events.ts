// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// One JSONL record per line in events.jsonl. Every record has {t, seq, type}.
import { z } from "zod";
import { Action, ActionResult } from "./action.ts";
import { Answer, DecisionError, Questions } from "./decision.ts";
import { Rect } from "./geometry.ts";
import { EffectClass, Plan, Predicate, TaskSpec } from "./task.ts";

const Base = { t: z.number().int().nonnegative(), seq: z.number().int().nonnegative(), runId: z.string() };

export const RouterMode = z.enum(["A", "B", "C", "D1", "D2", "H"]);
export type RouterMode = z.infer<typeof RouterMode>;

export const RunOutcome = z.enum(["success", "failure", "budget_exhausted", "stuck", "aborted", "error"]);
export type RunOutcome = z.infer<typeof RunOutcome>;

export const VerifyState = z.enum(["satisfied", "unsatisfied", "unknown"]);
export type VerifyState = z.infer<typeof VerifyState>;

export const GateName = z.enum([
  "operation_confidence",
  "target_confidence",
  "target_named",
  "effect_allowed",
  "snapshot_fresh",
  "budget",
  "repeat",
]);
export type GateName = z.infer<typeof GateName>;

export const StepTiming = z.object({
  settleMs: z.number().nonnegative(),
  observeMs: z.number().nonnegative(),
  decideMs: z.number().nonnegative(),
  actMs: z.number().nonnegative(),
  verifyMs: z.number().nonnegative(),
});
export type StepTiming = z.infer<typeof StepTiming>;

export const RunEvent = z.discriminatedUnion("type", [
  z.object({
    ...Base,
    type: z.literal("run.start"),
    task: TaskSpec,
    gitSha: z.string().optional(),
    decisionModel: z.string(),
    surface: z.string(),
  }),
  z.object({ ...Base, type: z.literal("plan"), plan: Plan }),
  z.object({ ...Base, type: z.literal("subgoal.start"), subgoalId: z.string(), goal: z.string() }),
  z.object({
    ...Base,
    type: z.literal("observe"),
    step: z.number().int(),
    snapshotId: z.string(),
    url: z.string().optional(),
    elementCount: z.number().int(),
    tokenEstimate: z.number().int(),
    screenshot: z.string().optional(),
    /** Screen fingerprint key (app map). */
    screen: z.string().optional(),
    /** Code-measured surface quality of the element table (0-1). */
    quality: z.number().min(0).max(1).optional(),
  }),
  z.object({
    ...Base,
    type: z.literal("decision.request"),
    step: z.number().int(),
    purpose: z.enum(["act", "verify", "narrow", "replay"]),
    questions: Questions,
    /** The rendered state is stored in a sidecar file to keep events small. */
    stateFile: z.string().optional(),
    stateTokens: z.number().int(),
  }),
  z.object({
    ...Base,
    type: z.literal("decision.answer"),
    step: z.number().int(),
    answers: z.record(z.string(), Answer).optional(),
    error: DecisionError.optional(),
    model: z.string(),
    requestId: z.string().optional(),
    latencyMs: z.number(),
    costUsd: z.number(),
    inputTokens: z.number().int(),
  }),
  z.object({
    ...Base,
    type: z.literal("model.call"),
    step: z.number().int().optional(),
    role: z.string(),
    model: z.string(),
    latencyMs: z.number(),
    costUsd: z.number().optional(),
    ok: z.boolean(),
    summary: z.string().optional(),
  }),
  z.object({
    ...Base,
    type: z.literal("gate"),
    step: z.number().int(),
    gate: GateName,
    passed: z.boolean(),
    detail: z.string().optional(),
  }),
  z.object({
    ...Base,
    type: z.literal("action"),
    step: z.number().int(),
    action: Action,
    /** Fingerprint of the target element, for replay. */
    target: z
      .object({
        stableId: z.string(),
        role: z.string(),
        name: z.string(),
        automationId: z.string().optional(),
        /** Top-viewport CSS pixels at observe time (live-view overlay). */
        bounds: Rect.optional(),
        /** The decision model's confidence in this target. */
        confidence: z.number().min(0).max(1).optional(),
      })
      .optional(),
    /** Effect class the gates allowed (advance/commit), for recipes. */
    effectClass: EffectClass.optional(),
    /** Fingerprint of a drag's drop zone, for replay. */
    destination: z
      .object({
        stableId: z.string(),
        role: z.string(),
        name: z.string(),
        automationId: z.string().optional(),
      })
      .optional(),
    mode: RouterMode,
  }),
  z.object({ ...Base, type: z.literal("effect"), step: z.number().int(), result: ActionResult }),
  z.object({
    ...Base,
    type: z.literal("verify"),
    step: z.number().int(),
    state: VerifyState,
    decidedBy: z.enum(["deterministic", "oracle", "decision", "vision", "none"]),
    predicates: z.array(z.object({ predicate: Predicate, state: VerifyState })),
  }),
  z.object({
    ...Base,
    type: z.literal("escalate"),
    step: z.number().int(),
    from: RouterMode,
    to: RouterMode,
    reason: z.string(),
    /** "down" for a de-escalation (back to a cheaper mode); absent means up. */
    direction: z.enum(["up", "down"]).optional(),
  }),
  z.object({
    ...Base,
    type: z.literal("human"),
    step: z.number().int(),
    kind: z.enum(["approval", "takeover", "input"]),
    detail: z.string(),
    granted: z.boolean().optional(),
  }),
  z.object({
    ...Base,
    type: z.literal("step.end"),
    step: z.number().int(),
    timing: StepTiming,
    mode: RouterMode,
  }),
  z.object({
    ...Base,
    type: z.literal("subgoal.end"),
    subgoalId: z.string(),
    state: VerifyState,
    steps: z.number().int(),
  }),
  z.object({
    ...Base,
    type: z.literal("run.end"),
    outcome: RunOutcome,
    reason: z.string(),
    steps: z.number().int(),
    wallMs: z.number(),
    costUsd: z.number(),
    decisionCalls: z.number().int(),
    modelCalls: z.number().int(),
    /** "Who did the work": share of steps per router mode. */
    modeShares: z.record(z.string(), z.number()),
    /** The agent's reported answer, for tasks that ask for one (redacted like everything else). */
    answer: z.string().optional(),
    answeredBy: z.enum(["decision", "writer", "vision"]).optional(),
  }),
]);
export type RunEvent = z.infer<typeof RunEvent>;
export type RunEventType = RunEvent["type"];
/** A RunEvent before the recorder assigns t and seq. */
export type RunEventDraft = RunEvent extends infer E
  ? E extends RunEvent
    ? Omit<E, "t" | "seq" | "runId">
    : never
  : never;
