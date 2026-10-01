// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Planner over the model client: the `planner` role's fallback chain with the draft schema as structured
// output, and an optional screenshot.
import { readFile } from "node:fs/promises";
import type {
  PlanInput,
  Planner,
  PlannerCallOptions,
  PlannerError,
  PlanOutput,
  RefineInput,
  ReplanInput,
  ToPlanOptions,
} from "@ghosthand/core";
import {
  buildPlannerPrompt,
  buildRefinePrompt,
  buildReplanPrompt,
  compileDraft,
  PLANNER_SYSTEM_PROMPT,
  PlanDraft,
  planCompileOptions,
  ReplanDraft,
  refineCompileOptions,
  replanCompileOptions,
} from "@ghosthand/core";
import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { ModelClient, ModelImage } from "./model-client.ts";
import type { ModelError } from "./model-error.ts";

export function plannerErrorFromModel(e: ModelError): PlannerError {
  const message = e.model === undefined ? e.message : `${e.model}: ${e.message}`;
  switch (e.kind) {
    case "not_configured":
    case "auth":
    case "rate_limit":
    case "budget":
    case "server":
    case "network":
      return { kind: "unavailable", message };
    case "timeout":
      return { kind: "timeout", message };
    case "aborted":
      return { kind: "aborted", message };
    case "schema_failed":
      return { kind: "invalid_plan", message };
    case "refused":
    case "unknown":
      return { kind: "provider", message };
  }
}

export function createModelPlanner(client: ModelClient, opts: { id?: string } = {}): Planner {
  const id = opts.id ?? "models";

  async function run(
    prompt: string,
    schema: typeof PlanDraft,
    compile: ToPlanOptions,
    screenshot: string | undefined,
    call: PlannerCallOptions,
  ): Promise<Result<PlanOutput, PlannerError>> {
    const images: ModelImage[] = [];
    if (screenshot !== undefined) {
      try {
        images.push({ data: new Uint8Array(await readFile(screenshot)), mediaType: "image/png" });
      } catch (e) {
        return err({
          kind: "provider",
          message: `cannot read screenshot: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
    const r = await client.generateStructured({
      role: "planner",
      system: PLANNER_SYSTEM_PROMPT,
      prompt,
      schema,
      schemaName: "plan",
      ...(images.length > 0 ? { images } : {}),
      ...(call.signal === undefined ? {} : { signal: call.signal }),
      ...(call.timeoutMs === undefined ? {} : { timeoutMs: call.timeoutMs }),
    });
    if (!r.ok) return err(plannerErrorFromModel(r.error));
    const compiled = compileDraft(r.value.value, compile);
    if (!compiled.ok) return compiled;
    return ok({
      ...compiled.value,
      planner: id,
      model: r.value.model,
      latencyMs: r.value.latencyMs,
      costUsd: r.value.costUsd,
    });
  }

  return {
    id,
    plan: (input: PlanInput, call: PlannerCallOptions = {}) =>
      run(buildPlannerPrompt(input), PlanDraft, planCompileOptions(input), input.screenshot, call),
    replan: (input: ReplanInput, call: PlannerCallOptions = {}) =>
      run(buildReplanPrompt(input), ReplanDraft, replanCompileOptions(input), input.screenshot, call),
    refine: (input: RefineInput, call: PlannerCallOptions = {}) =>
      run(buildRefinePrompt(input), ReplanDraft, refineCompileOptions(input), input.screenshot, call),
  };
}
