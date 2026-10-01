// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The app map (research note §2.2): screens (fingerprints), their stable elements, and transitions observed
// in runs, per app (origin). Path search over transitions reaches a screen with zero model calls.
import type { DatabaseSync } from "node:sqlite";
import type { RecordedTarget, ScreenFingerprint } from "@ghosthand/core";
import { type Element, err, ok, type Result } from "@ghosthand/protocol";
import { z } from "zod";
import { errorMessage, type KnowledgeError, transaction } from "./knowledge-db.ts";

export interface ScreenRecord {
  app: string;
  key: string;
  urlPattern: string;
  title: string;
  landmarks: string[];
  controls: string[];
  visits: number;
  firstSeen: number;
  lastSeen: number;
}

export interface ElementRecord {
  stableId: string;
  role: string;
  name: string;
  automationId?: string;
  risk: string;
  source: "runtime" | "source" | "both";
  seen: number;
}

export interface TransitionRecord {
  from: string;
  action: string;
  target: RecordedTarget;
  to: string;
  successes: number;
  failures: number;
}

export interface ScreenVisit {
  fingerprint: ScreenFingerprint;
  title: string;
  elements: readonly Element[];
  at: number;
}

export interface TransitionVisit {
  from: string;
  action: string;
  target: RecordedTarget;
  to: string;
  ok: boolean;
  at: number;
}

/** A path step: on screen `from`, do `action` on `target` to reach `to`. */
export type PathStep = TransitionRecord;

const Strings = z.array(z.string());
const parseStrings = (text: unknown): string[] => {
  try {
    const r = Strings.safeParse(JSON.parse(String(text)));
    return r.success ? r.data : [];
  } catch {
    return [];
  }
};

/** App id for a URL: its origin (`about:blank` for none). */
export function appOf(url: string | undefined): string {
  if (!url) return "about:blank";
  try {
    return new URL(url).origin;
  } catch {
    return "about:blank";
  }
}

const MAX_ELEMENTS_PER_SCREEN = 120;

export class AppMap {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Records screens, their named elements and transitions in one transaction. */
  record(app: string, screens: readonly ScreenVisit[], transitions: readonly TransitionVisit[]) {
    const upsertScreen = this.#db.prepare(
      `INSERT INTO screens (app, key, url_pattern, title, landmarks, controls, visits, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(app, key) DO UPDATE SET visits = visits + 1, last_seen = excluded.last_seen,
         title = excluded.title, controls = excluded.controls`,
    );
    const upsertElement = this.#db.prepare(
      `INSERT INTO elements (app, screen, stable_id, role, name, automation_id, risk, source, seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'runtime', 1, ?)
       ON CONFLICT(app, screen, stable_id) DO UPDATE SET seen = seen + 1, last_seen = excluded.last_seen,
         name = excluded.name, automation_id = excluded.automation_id,
         source = CASE WHEN source = 'source' THEN 'both' ELSE source END`,
    );
    const upsertTransition = this.#db.prepare(
      `INSERT INTO transitions (app, from_screen, action, stable_id, role, name, automation_id, to_screen,
         successes, failures, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(app, from_screen, action, stable_id, to_screen) DO UPDATE SET
         successes = successes + excluded.successes, failures = failures + excluded.failures,
         last_seen = excluded.last_seen, name = excluded.name`,
    );
    return transaction(this.#db, () => {
      for (const s of screens) {
        const fp = s.fingerprint;
        upsertScreen.run(
          app,
          fp.key,
          fp.urlPattern,
          s.title.slice(0, 200),
          JSON.stringify(fp.landmarks),
          JSON.stringify(fp.controls),
          s.at,
          s.at,
        );
        const named = s.elements.filter((e) => e.name.trim() !== "" && e.actions.length > 0);
        for (const e of named.slice(0, MAX_ELEMENTS_PER_SCREEN)) {
          upsertElement.run(
            app,
            fp.key,
            e.stableId,
            e.role,
            e.name.slice(0, 200),
            e.automationId ?? null,
            e.risk,
            s.at,
          );
        }
      }
      for (const t of transitions) {
        upsertTransition.run(
          app,
          t.from,
          t.action,
          t.target.stableId,
          t.target.role,
          t.target.name.slice(0, 200),
          t.target.automationId ?? null,
          t.to,
          t.ok ? 1 : 0,
          t.ok ? 0 : 1,
          t.at,
        );
      }
      return screens.length + transitions.length;
    });
  }

  /** Marks elements whose automation id is a known source test id (provenance "both"/"source"). */
  markSourceTestids(app: string, testids: readonly string[]): Result<number, KnowledgeError> {
    const set = this.#db.prepare(
      `UPDATE elements SET source = CASE WHEN source = 'runtime' THEN 'both' ELSE source END
       WHERE app = ? AND automation_id = ?`,
    );
    return transaction(this.#db, () => {
      let n = 0;
      for (const id of testids) n += Number(set.run(app, id).changes);
      return n;
    });
  }

  screens(app?: string): Result<ScreenRecord[], KnowledgeError> {
    try {
      const rows =
        app === undefined
          ? this.#db.prepare("SELECT * FROM screens ORDER BY app, last_seen DESC").all()
          : this.#db.prepare("SELECT * FROM screens WHERE app = ? ORDER BY last_seen DESC").all(app);
      return ok(
        rows.map((r) => ({
          app: String(r.app),
          key: String(r.key),
          urlPattern: String(r.url_pattern),
          title: String(r.title),
          landmarks: parseStrings(r.landmarks),
          controls: parseStrings(r.controls),
          visits: Number(r.visits),
          firstSeen: Number(r.first_seen),
          lastSeen: Number(r.last_seen),
        })),
      );
    } catch (e) {
      return err({ kind: "io", message: errorMessage(e) });
    }
  }

  elements(app: string, screen: string): Result<ElementRecord[], KnowledgeError> {
    try {
      const rows = this.#db
        .prepare("SELECT * FROM elements WHERE app = ? AND screen = ? ORDER BY seen DESC, name")
        .all(app, screen);
      return ok(
        rows.map((r) => ({
          stableId: String(r.stable_id),
          role: String(r.role),
          name: String(r.name),
          ...(r.automation_id ? { automationId: String(r.automation_id) } : {}),
          risk: String(r.risk),
          source: r.source === "source" ? "source" : r.source === "both" ? "both" : "runtime",
          seen: Number(r.seen),
        })),
      );
    } catch (e) {
      return err({ kind: "io", message: errorMessage(e) });
    }
  }

  transitions(app: string): Result<TransitionRecord[], KnowledgeError> {
    try {
      const rows = this.#db
        .prepare("SELECT * FROM transitions WHERE app = ? ORDER BY successes DESC")
        .all(app);
      return ok(
        rows.map((r) => ({
          from: String(r.from_screen),
          action: String(r.action),
          target: {
            stableId: String(r.stable_id),
            role: String(r.role),
            name: String(r.name),
            ...(r.automation_id ? { automationId: String(r.automation_id) } : {}),
          },
          to: String(r.to_screen),
          successes: Number(r.successes),
          failures: Number(r.failures),
        })),
      );
    } catch (e) {
      return err({ kind: "io", message: errorMessage(e) });
    }
  }

  /**
   * Shortest path (fewest transitions) from screen `from` to a screen satisfying `goal`, over transitions
   * that succeeded more often than they failed and that move to another screen. Zero model calls.
   */
  findPath(
    app: string,
    from: string,
    goal: string | ((screen: string) => boolean),
    maxDepth = 8,
  ): Result<PathStep[] | undefined, KnowledgeError> {
    const all = this.transitions(app);
    if (!all.ok) return all;
    const reached = typeof goal === "string" ? (s: string) => s === goal : goal;
    if (reached(from)) return ok([]);
    const edges = new Map<string, TransitionRecord[]>();
    for (const t of all.value) {
      if (t.successes <= t.failures || t.from === t.to) continue;
      const list = edges.get(t.from) ?? [];
      list.push(t);
      edges.set(t.from, list);
    }
    const prev = new Map<string, TransitionRecord>();
    const seen = new Set([from]);
    let frontier = [from];
    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const s of frontier) {
        for (const t of edges.get(s) ?? []) {
          if (seen.has(t.to)) continue;
          seen.add(t.to);
          prev.set(t.to, t);
          if (reached(t.to)) {
            const path: PathStep[] = [];
            for (let at: string | undefined = t.to; at !== undefined && at !== from; ) {
              const step = prev.get(at);
              if (!step) break;
              path.unshift(step);
              at = step.from;
            }
            return ok(path);
          }
          next.push(t.to);
        }
      }
      frontier = next;
    }
    return ok(undefined);
  }
}
