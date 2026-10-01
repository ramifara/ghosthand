// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Planner over an AgentConsultant (the user's own signed-in Codex or Claude CLI): one warm session, one
// turn per plan or replan, the draft JSON Schema as the turn's output schema, and an optional screenshot.
import type {
  PlanInput,
  Planner,
  PlannerCallOptions,
  PlannerError,
  PlanOutput,
  ReplanInput,
  ToPlanOptions,
} from "@ghosthand/core";
import {
  buildPlannerPrompt,
  buildReplanPrompt,
  compileDraft,
  PLAN_DRAFT_JSON_SCHEMA,
  PLANNER_SYSTEM_PROMPT,
  planCompileOptions,
  REPLAN_DRAFT_JSON_SCHEMA,
  replanCompileOptions,
} from "@ghosthand/core";
import type { AgentConsultant, ConsultantError, ConsultantSession, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";

export interface ConsultantPlannerOptions {
  /** CLI model; pass it explicitly, otherwise the session follows the user's CLI config. */
  model?: string;
  /** Reasoning effort per turn. Default `low`. */
  effort?: "low" | "medium" | "high";
  /** Default per-turn timeout. Default 120 s. */
  timeoutMs?: number;
}

export interface ConsultantPlanner extends Planner {
  /** Closes the warm consultant session, if one is open. */
  close(): Promise<void>;
}

/** Codex names kept for existing callers. */
export type CodexPlannerOptions = ConsultantPlannerOptions;
export type CodexPlanner = ConsultantPlanner;
export type ClaudePlannerOptions = ConsultantPlannerOptions;
export type ClaudePlanner = ConsultantPlanner;

export function plannerErrorFromConsultant(e: ConsultantError, consultant = "codex"): PlannerError {
  switch (e.kind) {
    case "not_installed":
    case "unauthenticated":
    case "usage_limit":
    case "process":
      return { kind: "unavailable", message: `${consultant} ${e.kind}: ${e.message}` };
    case "timeout":
      return { kind: "timeout", message: e.message };
    case "cancelled":
      return { kind: "aborted", message: e.message };
    case "schema_failed":
      return { kind: "invalid_plan", message: e.message };
  }
}

/** Drop the session after these; the next call opens a fresh one. */
const BROKEN: ReadonlySet<ConsultantError["kind"]> = new Set(["process", "timeout", "cancelled"]);

export function createConsultantPlanner(
  consultant: AgentConsultant,
  opts: ConsultantPlannerOptions = {},
): ConsultantPlanner {
  const id = consultant.id;
  const effort = opts.effort ?? "low";
  let session: Promise<Result<ConsultantSession, ConsultantError>> | undefined;

  const getSession = (): Promise<Result<ConsultantSession, ConsultantError>> => {
    if (session === undefined) {
      const opening = consultant.open({
        system: PLANNER_SYSTEM_PROMPT,
        ...(opts.model === undefined ? {} : { model: opts.model }),
      });
      session = opening;
      void opening.then((r) => {
        if (!r.ok && session === opening) session = undefined;
      });
    }
    return session;
  };

  const drop = async (): Promise<void> => {
    const current = session;
    session = undefined;
    const r = await current;
    if (r?.ok) await r.value.close();
  };

  async function run(
    prompt: string,
    schema: Record<string, unknown>,
    compile: ToPlanOptions,
    screenshot: string | undefined,
    call: PlannerCallOptions,
  ): Promise<Result<PlanOutput, PlannerError>> {
    if (call.signal?.aborted === true) return err({ kind: "aborted", message: "aborted before planning" });
    const started = Date.now();
    const s = await getSession();
    if (!s.ok) return err(plannerErrorFromConsultant(s.error, id));
    const timeoutMs = call.timeoutMs ?? opts.timeoutMs;
    const answer = await s.value.ask<unknown>({
      prompt,
      schema,
      parse: (v) => v,
      effort,
      ...(screenshot === undefined ? {} : { images: [screenshot] }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(call.signal === undefined ? {} : { signal: call.signal }),
    });
    if (!answer.ok) {
      if (BROKEN.has(answer.error.kind)) await drop();
      return err(plannerErrorFromConsultant(answer.error, id));
    }
    const compiled = compileDraft(answer.value, compile);
    if (!compiled.ok) return compiled;
    return ok({
      ...compiled.value,
      planner: id,
      latencyMs: Date.now() - started,
      ...(opts.model === undefined ? {} : { model: opts.model }),
    });
  }

  return {
    id,
    plan: (input: PlanInput, call: PlannerCallOptions = {}) =>
      run(
        buildPlannerPrompt(input),
        PLAN_DRAFT_JSON_SCHEMA,
        planCompileOptions(input),
        input.screenshot,
        call,
      ),
    replan: (input: ReplanInput, call: PlannerCallOptions = {}) =>
      run(
        buildReplanPrompt(input),
        REPLAN_DRAFT_JSON_SCHEMA,
        replanCompileOptions(input),
        input.screenshot,
        call,
      ),
    close: drop,
  };
}

/** Planner over the user's signed-in Codex CLI. */
export function createCodexPlanner(
  consultant: AgentConsultant,
  opts: CodexPlannerOptions = {},
): CodexPlanner {
  return createConsultantPlanner(consultant, opts);
}

/**
 * Planner over the user's own `claude` CLI login (see `claude/claude-consultant.ts` for the policy
 * notes). Effort maps to `--effort`; the default `low` keeps planning turns short.
 */
export function createClaudePlanner(
  consultant: AgentConsultant,
  opts: ClaudePlannerOptions = {},
): ClaudePlanner {
  return createConsultantPlanner(consultant, opts);
}
