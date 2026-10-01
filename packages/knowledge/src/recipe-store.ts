// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Recipe persistence: learn (insert or re-learn as a new version), outcome updates with trust decay and
// heal patches, list/show. Bodies are JSON validated with the Recipe schema on every read.
import type { DatabaseSync } from "node:sqlite";
import type { ReplayReport } from "@ghosthand/core";
import { err, ok, type Result } from "@ghosthand/protocol";
import { errorMessage, type KnowledgeError } from "./knowledge-db.ts";
import { Recipe } from "./recipe-schema.ts";
import { afterFailure, afterSuccess, INITIAL_TRUST } from "./trust.ts";

const MAX_LEARNED_FROM = 10;

export interface RecipeOutcome {
  runId: string;
  /** The run passed its final checks (and the oracle, when there is one). */
  ok: boolean;
  replay: ReplayReport;
}

export class RecipeStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  #write(r: Recipe): Result<Recipe, KnowledgeError> {
    const parsed = Recipe.safeParse(r);
    if (!parsed.success) return err({ kind: "invalid", message: `invalid recipe: ${parsed.error.message}` });
    const v = parsed.data;
    try {
      this.#db
        .prepare(
          `INSERT INTO recipes (id, app, task_id, intent, status, trust, successes, failures,
             consecutive_failures, version, created_at, updated_at, last_success_at, body)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET app = excluded.app, task_id = excluded.task_id,
             intent = excluded.intent, status = excluded.status, trust = excluded.trust,
             successes = excluded.successes, failures = excluded.failures,
             consecutive_failures = excluded.consecutive_failures, version = excluded.version,
             updated_at = excluded.updated_at, last_success_at = excluded.last_success_at, body = excluded.body`,
        )
        .run(
          v.id,
          v.app,
          v.taskId ?? null,
          v.intent,
          v.status,
          v.trust,
          v.successes,
          v.failures,
          v.consecutiveFailures,
          v.version,
          v.createdAt,
          v.updatedAt,
          v.lastSuccessAt ?? null,
          JSON.stringify(v),
        );
      return ok(v);
    } catch (e) {
      return err({ kind: "io", message: `recipe write failed: ${errorMessage(e)}` });
    }
  }

  get(id: string): Result<Recipe, KnowledgeError> {
    try {
      const row = this.#db.prepare("SELECT body FROM recipes WHERE id = ?").get(id);
      if (row === undefined) return err({ kind: "not_found", message: `no recipe ${id}` });
      return parseBody(row.body);
    } catch (e) {
      return err({ kind: "io", message: errorMessage(e) });
    }
  }

  list(opts: { app?: string; status?: Recipe["status"] } = {}): Result<Recipe[], KnowledgeError> {
    try {
      const where: string[] = [];
      const args: string[] = [];
      if (opts.app !== undefined) {
        where.push("app = ?");
        args.push(opts.app);
      }
      if (opts.status !== undefined) {
        where.push("status = ?");
        args.push(opts.status);
      }
      const sql = `SELECT body FROM recipes${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC`;
      const out: Recipe[] = [];
      for (const row of this.#db.prepare(sql).all(...args)) {
        const r = parseBody(row.body);
        if (r.ok) out.push(r.value);
      }
      return ok(out);
    } catch (e) {
      return err({ kind: "io", message: errorMessage(e) });
    }
  }

  /**
   * Stores a freshly induced recipe. An existing recipe with the same id is re-learned: new steps, version
   * + 1, active again, counters kept, trust at least the initial value.
   */
  learn(fresh: Recipe): Result<{ recipe: Recipe; created: boolean }, KnowledgeError> {
    const existing = this.get(fresh.id);
    if (!existing.ok && existing.error.kind !== "not_found") return existing;
    if (!existing.ok) {
      const w = this.#write(fresh);
      return w.ok ? ok({ recipe: w.value, created: true }) : w;
    }
    const old = existing.value;
    const merged: Recipe = {
      ...fresh,
      version: old.version + 1,
      trust: Math.max(old.trust, INITIAL_TRUST),
      successes: old.successes + 1,
      failures: old.failures,
      consecutiveFailures: 0,
      heals: old.heals,
      learnedFrom: [...old.learnedFrom, ...fresh.learnedFrom].slice(-MAX_LEARNED_FROM),
      createdAt: old.createdAt,
    };
    const w = this.#write(merged);
    return w.ok ? ok({ recipe: w.value, created: false }) : w;
  }

  /**
   * Applies a replay's outcome: success raises trust (less when healed) and patches healed targets into the
   * recipe (version + 1); failure lowers trust and retires the recipe after two in a row.
   */
  recordOutcome(id: string, outcome: RecipeOutcome, now: number): Result<Recipe, KnowledgeError> {
    const got = this.get(id);
    if (!got.ok) return got;
    let r = got.value;
    const fullyReplayed = outcome.replay.fellBackAt === undefined;
    if (outcome.ok && fullyReplayed) {
      const healed = outcome.replay.heals.length > 0;
      r = afterSuccess(r, healed, now);
      if (healed) {
        const steps = r.steps.map((s, i) => {
          const h = outcome.replay.heals.find((x) => x.index === i);
          return h ? { ...s, target: h.target } : s;
        });
        r = { ...r, steps, version: r.version + 1, heals: r.heals + outcome.replay.heals.length };
      }
    } else if (!outcome.ok || !fullyReplayed) {
      r = afterFailure(r, now);
    }
    return this.#write(r);
  }

  remove(id: string): Result<boolean, KnowledgeError> {
    try {
      return ok(Number(this.#db.prepare("DELETE FROM recipes WHERE id = ?").run(id).changes) > 0);
    } catch (e) {
      return err({ kind: "io", message: errorMessage(e) });
    }
  }
}

function parseBody(body: unknown): Result<Recipe, KnowledgeError> {
  try {
    const r = Recipe.safeParse(JSON.parse(String(body)));
    return r.success
      ? ok(r.data)
      : err({ kind: "corrupt", message: `recipe body invalid: ${r.error.message}` });
  } catch (e) {
    return err({ kind: "corrupt", message: `recipe body is not JSON: ${errorMessage(e)}` });
  }
}
