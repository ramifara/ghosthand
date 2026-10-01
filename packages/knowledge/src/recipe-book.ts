// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Recipe retrieval for mode A (research note §2.3): code-first. A recipe matches when it is usable (trust),
// belongs to the task's app, its intent template binds the task instruction, its start screen matches the
// live start screen (same fingerprint key or URL pattern), and the task offers every secret it types.
// Among several matches the most trusted wins (no model call).
import { type RecipeBook, type RecipeMatch, type RecipeStep, screenFingerprint } from "@ghosthand/core";
import type { Snapshot, TaskSpec } from "@ghosthand/protocol";
import { appOf } from "./app-map.ts";
import { bindIntent, bindValue } from "./parameterize.ts";
import type { Recipe } from "./recipe-schema.ts";
import type { RecipeStore } from "./recipe-store.ts";
import { effectiveTrust, usable } from "./trust.ts";

export interface RecipeCandidate {
  recipe: Recipe;
  params: Record<string, string>;
  trust: number;
}

/** Recipes that fit this task on this start screen, most trusted first. */
export function candidateRecipes(
  recipes: readonly Recipe[],
  task: TaskSpec,
  start: Snapshot,
  now: number,
): RecipeCandidate[] {
  const app = appOf(task.startUrl);
  const fp = screenFingerprint(start);
  const out: RecipeCandidate[] = [];
  for (const r of recipes) {
    if (r.app !== app || !usable(r, now)) continue;
    if (r.startScreen.key !== fp.key && r.startScreen.urlPattern !== fp.urlPattern) continue;
    if (!r.secrets.every((s) => task.secrets.includes(s))) continue;
    const params = bindIntent(r.intent, task.instruction);
    if (!params) continue;
    out.push({ recipe: r, params, trust: effectiveTrust(r, now) });
  }
  return out.sort((a, b) => b.trust - a.trust);
}

export function bindRecipe(c: RecipeCandidate): RecipeMatch {
  const r = c.recipe;
  const steps: RecipeStep[] = r.steps.map((s) => ({
    action: bindValue(s.action, c.params),
    target: s.target,
    ...(s.destination ? { destination: s.destination } : {}),
    ...(s.screen ? { screen: s.screen } : {}),
    effect: s.effect,
  }));
  return {
    recipeId: r.id,
    version: r.version,
    intent: r.intent,
    trust: c.trust,
    steps,
    params: c.params,
    ...(r.plan ? { plan: bindValue(r.plan, c.params) } : {}),
  };
}

export interface RecipeBookOptions {
  now?: () => number;
  /** Called with the chosen candidate (logging). */
  onMatch?: (c: RecipeCandidate) => void;
}

/** A core RecipeBook over the store. */
export function createRecipeBook(store: RecipeStore, opts: RecipeBookOptions = {}): RecipeBook {
  const now = opts.now ?? Date.now;
  return {
    match(task: TaskSpec, start: Snapshot): RecipeMatch | undefined {
      const all = store.list({ app: appOf(task.startUrl), status: "active" });
      if (!all.ok) return undefined;
      const best = candidateRecipes(all.value, task, start, now())[0];
      if (!best) return undefined;
      opts.onMatch?.(best);
      return bindRecipe(best);
    },
  };
}
