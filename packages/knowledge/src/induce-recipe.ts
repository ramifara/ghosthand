// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Recipe induction from one verified run (research note §2.3): keep the actions that took effect (drop
// refused and no-op attempts, waits and answer reads), keep durable target fingerprints, turn literals
// from the instruction into parameters, and keep the plan whose checks held. Vision-only steps (capture
// coordinates) are not learned in v1.
import { extractLiterals, fnv1a, type ScreenFingerprint, urlPattern } from "@ghosthand/core";
import {
  type Action,
  err,
  ok,
  type Plan,
  type Result,
  type RunEvent,
  type TaskSpec,
} from "@ghosthand/protocol";
import { appOf } from "./app-map.ts";
import type { KnowledgeError } from "./knowledge-db.ts";
import { parameterize, templateValue } from "./parameterize.ts";
import type { Recipe, StoredStep } from "./recipe-schema.ts";
import { INITIAL_TRUST } from "./trust.ts";

export interface InduceOptions {
  runId: string;
  now: number;
  /** Fingerprints by step, from the live run (better start-screen matching than event keys alone). */
  fingerprints?: ReadonlyMap<number, ScreenFingerprint>;
}

/** Recipe id: `<host>/<task id>` for named tasks, `<host>/<slug>-<hash>` for free-text goals. */
export function recipeId(task: Pick<TaskSpec, "id" | "startUrl">, intent: string): string {
  let host = "local";
  try {
    host = new URL(task.startUrl).host;
  } catch {
    // keep "local"
  }
  if (task.id !== "adhoc") return `${host}/${task.id}`;
  const slug = intent
    .toLowerCase()
    .replace(/\{\{[a-z0-9_]+\}\}/g, "x")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${host}/${slug}-${fnv1a(intent).slice(0, 6)}`;
}

const usesCapture = (a: Action): boolean => {
  const pts = a.type === "click" || a.type === "move" ? [a.target] : a.type === "drag" ? [a.from, a.to] : [];
  return pts.some((p) => "captureId" in p || "screenX" in p);
};

/** Literal values an action typed or selected (candidates for parameters). */
function literalOf(a: Action): string | undefined {
  switch (a.type) {
    case "set_value":
      return typeof a.value === "string" ? a.value : undefined;
    case "type_text":
      return typeof a.text === "string" ? a.text : undefined;
    case "select_option":
      return a.option;
    case "select_text":
      return a.text;
    default:
      return undefined;
  }
}

export function induceRecipe(
  events: readonly RunEvent[],
  opts: InduceOptions,
): Result<Recipe, KnowledgeError> {
  const start = events.find((e) => e.type === "run.start");
  const end = events.findLast((e) => e.type === "run.end");
  if (start?.type !== "run.start") return err({ kind: "invalid", message: "run has no run.start event" });
  if (end?.type !== "run.end" || end.outcome !== "success")
    return err({ kind: "invalid", message: "only successful runs become recipes" });
  const task = start.task;
  const planEvent = events.findLast((e) => e.type === "plan");
  const plan: Plan | undefined = planEvent?.type === "plan" ? planEvent.plan : task.plan;

  const screenAt = new Map<number, { key: string; url?: string }>();
  const effects = new Map<number, string>();
  for (const e of events) {
    if (e.type === "observe" && e.screen && !screenAt.has(e.step))
      screenAt.set(e.step, { key: e.screen, ...(e.url ? { url: e.url } : {}) });
    if (e.type === "effect") effects.set(e.step, e.result.effect);
  }
  const nextScreen = (step: number): string | undefined => {
    for (const [s, v] of [...screenAt].sort((a, b) => a[0] - b[0])) if (s > step) return v.key;
    return undefined;
  };

  const steps: StoredStep[] = [];
  const literals: string[] = [];
  for (const e of events) {
    if (e.type !== "action") continue;
    const effect = effects.get(e.step);
    if (effect === "refused" || effect === "suspected_noop") continue;
    if (e.action.type === "wait") continue;
    if (usesCapture(e.action))
      return err({
        kind: "invalid",
        message: `step ${e.step} used screen coordinates (vision); not learned`,
      });
    const lit = literalOf(e.action);
    if (lit !== undefined) literals.push(lit);
    const screen = screenAt.get(e.step);
    const fp = opts.fingerprints?.get(e.step);
    const to = nextScreen(e.step);
    steps.push({
      action: e.action,
      target: e.target
        ? {
            stableId: e.target.stableId,
            role: e.target.role,
            name: e.target.name,
            ...(e.target.automationId ? { automationId: e.target.automationId } : {}),
          }
        : null,
      ...(e.destination ? { destination: e.destination } : {}),
      ...(screen
        ? { screen: { key: screen.key, urlPattern: fp?.urlPattern ?? urlPattern(screen.url) } }
        : {}),
      ...(to ? { to } : {}),
      effect: e.effectClass ?? "advance",
    });
  }
  if (steps.length === 0) return err({ kind: "invalid", message: "the run has no effective actions" });

  const instructionLiterals = new Set(extractLiterals(task.instruction));
  const p = parameterize(
    task.instruction,
    literals.filter((l) => instructionLiterals.has(l) || task.instruction.includes(l)),
  );
  const templated = steps.map((s) => ({ ...s, action: templateValue(s.action, p.replacements) }));
  const firstStep = Math.min(...[...screenAt.keys()]);
  const first = screenAt.get(firstStep);
  const firstFp = opts.fingerprints?.get(firstStep);
  const secrets = [
    ...new Set(
      steps.flatMap((s) =>
        s.action.type === "set_value" && typeof s.action.value !== "string" ? [s.action.value.secretRef] : [],
      ),
    ),
  ];
  const recipe: Recipe = {
    id: recipeId(task, p.intent),
    version: 1,
    app: appOf(task.startUrl),
    ...(task.id !== "adhoc" ? { taskId: task.id } : {}),
    intent: p.intent,
    params: p.params,
    startUrl: task.startUrl,
    startScreen: {
      key: firstFp?.key ?? first?.key ?? "",
      urlPattern: firstFp?.urlPattern ?? urlPattern(first?.url ?? task.startUrl),
    },
    steps: templated,
    ...(plan ? { plan: templateValue(plan, p.replacements) } : {}),
    secrets,
    status: "active",
    trust: INITIAL_TRUST,
    successes: 1,
    failures: 0,
    consecutiveFailures: 0,
    heals: 0,
    learnedFrom: [opts.runId],
    createdAt: opts.now,
    updatedAt: opts.now,
    lastSuccessAt: opts.now,
  };
  return ok(recipe);
}
