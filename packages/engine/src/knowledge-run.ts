// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Knowledge around a run (ADR 0010): recipes are offered to the loop (mode A) when enabled; after the run
// the replay outcome updates the recipe's trust, and with `learn` a verified run updates the app map and
// learns (or re-learns) a recipe.
import type { ReplayReport } from "@ghosthand/core";
import { type Knowledge, type LearningSession, openKnowledge } from "@ghosthand/knowledge";
import type { RunEvent, TaskSpec } from "@ghosthand/protocol";
import type { EngineRuntime } from "./runtime.ts";

/** Active recipes as `{id, title}` (MCP `list_recipes`). */
export function listRecipeSummaries(rt: EngineRuntime): Array<{ id: string; title: string }> {
  const kb = openKnowledgeFor(rt);
  if (!kb) return [];
  try {
    const r = kb.recipes.list({ status: "active" });
    return r.ok ? r.value.map((x) => ({ id: x.id, title: x.intent })) : [];
  } finally {
    kb.close();
  }
}

export interface KnowledgeOptions {
  kb: Knowledge;
  /** Offer verified recipes to the loop (mode A). */
  recipes: boolean;
  /** Learn from verified runs: app map + recipe induction. */
  learn: boolean;
}

export interface KnowledgeOutcome {
  recipeUsed?: ReplayReport;
  learned?: { id: string; version: number; created: boolean };
  mapped?: { screens: number; transitions: number };
  /** Why nothing was learned. */
  skipped?: string;
  errors: string[];
}

/** Opens `<runsDir>/knowledge.sqlite`. */
export function openKnowledgeFor(rt: EngineRuntime): Knowledge | undefined {
  const k = openKnowledge({ runsDir: rt.runsDir });
  if (!k.ok) {
    rt.logger.warn({ pkg: "knowledge" }, k.error.message);
    return undefined;
  }
  return k.value;
}

/** Applies a finished run to the knowledge base. Never throws. */
export function afterRun(
  opts: KnowledgeOptions,
  run: {
    runId: string;
    task: TaskSpec;
    events: readonly RunEvent[];
    passed: boolean;
    replay: ReplayReport | undefined;
    session: LearningSession;
  },
): KnowledgeOutcome {
  const out: KnowledgeOutcome = { errors: [] };
  const { kb } = opts;
  if (run.replay) {
    out.recipeUsed = run.replay;
    const r = kb.recordOutcome(run.replay.recipeId, { runId: run.runId, ok: run.passed, replay: run.replay });
    if (!r.ok) out.errors.push(r.error.message);
  }
  if (!opts.learn) return { ...out, skipped: "learning is off (--learn)" };
  if (!run.passed) return { ...out, skipped: "the run did not pass its checks" };
  const mapped = kb.recordMap(run.session, run.events);
  if (mapped.ok) out.mapped = mapped.value;
  else out.errors.push(mapped.error.message);
  // A clean replay already proves the stored recipe; re-learning it would only bump the version.
  if (run.replay && run.replay.fellBackAt === undefined && run.replay.heals.length === 0)
    return { ...out, skipped: "the recipe replayed cleanly" };
  const learned = kb.learn(run.events, { runId: run.runId, session: run.session });
  if (learned.ok)
    out.learned = {
      id: learned.value.recipe.id,
      version: learned.value.recipe.version,
      created: learned.value.created,
    };
  else out.skipped = learned.error.message;
  return out;
}
