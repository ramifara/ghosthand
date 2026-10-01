// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The knowledge facade the engine uses: one DB with the app map and recipes, a per-run session that
// collects fingerprints while the loop runs (cheap, in memory) and writes screens and transitions once at
// the end, and recipe learning and outcome updates.
import type { DatabaseSync } from "node:sqlite";
import type { RecipeBook, ScreenFingerprint } from "@ghosthand/core";
import type { Element, Result, RunEvent, Snapshot } from "@ghosthand/protocol";
import { AppMap, appOf, type ScreenVisit, type TransitionVisit } from "./app-map.ts";
import { induceRecipe } from "./induce-recipe.ts";
import { type KnowledgeError, openKnowledgeDb } from "./knowledge-db.ts";
import { createRecipeBook, type RecipeBookOptions } from "./recipe-book.ts";
import type { Recipe } from "./recipe-schema.ts";
import { type RecipeOutcome, RecipeStore } from "./recipe-store.ts";

export class LearningSession {
  readonly app: string;
  readonly fingerprints = new Map<number, ScreenFingerprint>();
  readonly #screens = new Map<
    string,
    { fp: ScreenFingerprint; title: string; elements: readonly Element[]; at: number }
  >();

  constructor(startUrl: string) {
    this.app = appOf(startUrl);
  }

  /** Loop hook (`LoopDeps.onSnapshot`). */
  readonly onSnapshot = (snapshot: Snapshot, fp: ScreenFingerprint, step: number): void => {
    if (!this.fingerprints.has(step)) this.fingerprints.set(step, fp);
    // Only same-app screens go into this app's map.
    if (appOf(snapshot.url) !== this.app) return;
    this.#screens.set(fp.key, {
      fp,
      title: snapshot.title,
      elements: snapshot.elements,
      at: snapshot.takenAt,
    });
  };

  screens(): ScreenVisit[] {
    return [...this.#screens.values()].map((s) => ({
      fingerprint: s.fp,
      title: s.title,
      elements: s.elements,
      at: s.at || Date.now(),
    }));
  }

  /** Transitions from the event stream: the screen an action ran on → the next observed screen. */
  transitions(events: readonly RunEvent[]): TransitionVisit[] {
    const screenAt = new Map<number, string>();
    for (const e of events)
      if (e.type === "observe" && e.screen && !screenAt.has(e.step)) screenAt.set(e.step, e.screen);
    const steps = [...screenAt.keys()].sort((a, b) => a - b);
    const effect = new Map<number, string>();
    for (const e of events) if (e.type === "effect") effect.set(e.step, e.result.effect);
    const out: TransitionVisit[] = [];
    for (const e of events) {
      if (e.type !== "action" || !e.target) continue;
      const from = screenAt.get(e.step);
      const nextStep = steps.find((s) => s > e.step);
      const to = nextStep === undefined ? undefined : screenAt.get(nextStep);
      if (!from || !to) continue;
      const eff = effect.get(e.step);
      out.push({
        from,
        action: e.action.type,
        target: e.target,
        to,
        ok: eff !== "refused" && eff !== "suspected_noop",
        at: e.t,
      });
    }
    return out;
  }
}

export interface LearnResult {
  recipe?: Recipe;
  created?: boolean;
  /** Why no recipe was learned. */
  skipped?: string;
  screens: number;
  transitions: number;
}

export class Knowledge {
  readonly db: DatabaseSync;
  readonly appMap: AppMap;
  readonly recipes: RecipeStore;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.appMap = new AppMap(db);
    this.recipes = new RecipeStore(db);
  }

  book(opts: RecipeBookOptions = {}): RecipeBook {
    return createRecipeBook(this.recipes, opts);
  }

  session(startUrl: string): LearningSession {
    return new LearningSession(startUrl);
  }

  /** Writes the session's screens and transitions; returns how many rows were touched. */
  recordMap(
    session: LearningSession,
    events: readonly RunEvent[],
  ): Result<{ screens: number; transitions: number }, KnowledgeError> {
    const screens = session.screens();
    const transitions = session.transitions(events);
    const r = this.appMap.record(session.app, screens, transitions);
    if (!r.ok) return r;
    return { ok: true, value: { screens: screens.length, transitions: transitions.length } };
  }

  /** Learns (or re-learns) a recipe from a verified run. Callers check the oracle before calling. */
  learn(
    events: readonly RunEvent[],
    opts: { runId: string; now?: number; session?: LearningSession },
  ): Result<{ recipe: Recipe; created: boolean }, KnowledgeError> {
    const induced = induceRecipe(events, {
      runId: opts.runId,
      now: opts.now ?? Date.now(),
      ...(opts.session ? { fingerprints: opts.session.fingerprints } : {}),
    });
    if (!induced.ok) return induced;
    return this.recipes.learn(induced.value);
  }

  recordOutcome(id: string, outcome: RecipeOutcome, now = Date.now()): Result<Recipe, KnowledgeError> {
    return this.recipes.recordOutcome(id, outcome, now);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}

/** Opens `<runsDir>/knowledge.sqlite` (or `path`, e.g. ":memory:"). */
export function openKnowledge(opts: { runsDir?: string; path?: string }): Result<Knowledge, KnowledgeError> {
  const db = openKnowledgeDb(opts);
  return db.ok ? { ok: true, value: new Knowledge(db.value) } : db;
}
