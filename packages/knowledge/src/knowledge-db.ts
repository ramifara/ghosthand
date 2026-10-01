// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The knowledge database (`<runsDir>/knowledge.sqlite`, next to the run index) over node:sqlite:
// app-map screens, elements and transitions, and recipes. Schema versions via PRAGMA user_version.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@ghosthand/protocol";

export type KnowledgeErrorKind = "io" | "not_found" | "corrupt" | "invalid";
export interface KnowledgeError {
  kind: KnowledgeErrorKind;
  message: string;
}

export const KNOWLEDGE_FILE = "knowledge.sqlite";

/** Each entry migrates from user_version = index to index + 1. Append only. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE screens (
     app TEXT NOT NULL,
     key TEXT NOT NULL,
     url_pattern TEXT NOT NULL,
     title TEXT NOT NULL DEFAULT '',
     landmarks TEXT NOT NULL DEFAULT '[]',
     controls TEXT NOT NULL DEFAULT '[]',
     visits INTEGER NOT NULL DEFAULT 0,
     first_seen INTEGER NOT NULL,
     last_seen INTEGER NOT NULL,
     PRIMARY KEY (app, key)
   );
   CREATE INDEX screens_url ON screens (app, url_pattern);
   CREATE TABLE elements (
     app TEXT NOT NULL,
     screen TEXT NOT NULL,
     stable_id TEXT NOT NULL,
     role TEXT NOT NULL,
     name TEXT NOT NULL,
     automation_id TEXT,
     risk TEXT NOT NULL DEFAULT 'unknown',
     source TEXT NOT NULL DEFAULT 'runtime',
     seen INTEGER NOT NULL DEFAULT 0,
     last_seen INTEGER NOT NULL,
     PRIMARY KEY (app, screen, stable_id)
   );
   CREATE TABLE transitions (
     app TEXT NOT NULL,
     from_screen TEXT NOT NULL,
     action TEXT NOT NULL,
     stable_id TEXT NOT NULL,
     role TEXT NOT NULL,
     name TEXT NOT NULL,
     automation_id TEXT,
     to_screen TEXT NOT NULL,
     successes INTEGER NOT NULL DEFAULT 0,
     failures INTEGER NOT NULL DEFAULT 0,
     last_seen INTEGER NOT NULL,
     PRIMARY KEY (app, from_screen, action, stable_id, to_screen)
   );
   CREATE TABLE recipes (
     id TEXT PRIMARY KEY,
     app TEXT NOT NULL,
     task_id TEXT,
     intent TEXT NOT NULL,
     status TEXT NOT NULL,
     trust REAL NOT NULL,
     successes INTEGER NOT NULL DEFAULT 0,
     failures INTEGER NOT NULL DEFAULT 0,
     consecutive_failures INTEGER NOT NULL DEFAULT 0,
     version INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     last_success_at INTEGER,
     body TEXT NOT NULL
   );
   CREATE INDEX recipes_app ON recipes (app, status);`,
];

export const KNOWLEDGE_SCHEMA_VERSION = MIGRATIONS.length;

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get();
  const current = Number(row?.user_version ?? 0);
  if (current > MIGRATIONS.length)
    throw new Error(`knowledge schema version ${current} is newer than supported ${MIGRATIONS.length}`);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v] ?? "");
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

/** Opens (creating and migrating) the knowledge DB: `<runsDir>/knowledge.sqlite`, or `path` (":memory:"). */
export function openKnowledgeDb(opts: {
  runsDir?: string;
  path?: string;
}): Result<DatabaseSync, KnowledgeError> {
  const path = opts.path ?? (opts.runsDir ? join(opts.runsDir, KNOWLEDGE_FILE) : ":memory:");
  try {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    migrate(db);
    return ok(db);
  } catch (e) {
    return err({ kind: "io", message: `cannot open knowledge DB at ${path}: ${errorMessage(e)}` });
  }
}

/** Runs `fn` in a transaction; rolls back on throw. */
export function transaction<T>(db: DatabaseSync, fn: () => T): Result<T, KnowledgeError> {
  try {
    db.exec("BEGIN");
    const out = fn();
    db.exec("COMMIT");
    return ok(out);
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // already rolled back
    }
    return err({ kind: "io", message: `knowledge write failed: ${errorMessage(e)}` });
  }
}
