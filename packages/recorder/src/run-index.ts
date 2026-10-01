// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// SQLite index of runs (<runsDir>/index.sqlite) over node:sqlite. Schema versions via PRAGMA user_version.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type RecorderError, type Result } from "@ghosthand/protocol";
import { z } from "zod";
import { INDEX_FILE } from "./run-folder.ts";
import { RunRecord } from "./run-record.ts";

/** Each entry migrates from user_version = index to index + 1. Append only. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE runs (
     id TEXT PRIMARY KEY,
     started_at INTEGER NOT NULL,
     ended_at INTEGER,
     task_id TEXT,
     instruction TEXT,
     start_url TEXT,
     outcome TEXT,
     reason TEXT,
     steps INTEGER NOT NULL DEFAULT 0,
     wall_ms REAL,
     cost_usd REAL NOT NULL DEFAULT 0,
     decision_calls INTEGER NOT NULL DEFAULT 0,
     model_calls INTEGER NOT NULL DEFAULT 0,
     decision_model TEXT,
     git_sha TEXT,
     folder TEXT NOT NULL
   );
   CREATE INDEX runs_started_at ON runs (started_at DESC);
   CREATE INDEX runs_task_id ON runs (task_id, started_at DESC);`,
];

export const INDEX_SCHEMA_VERSION = MIGRATIONS.length;

export type ListRunsOptions = { readonly limit?: number; readonly taskId?: string };

export type RunIndex = {
  readonly path: string;
  /** Inserts or replaces the row for `record.id`. Call on run start and again on finish. */
  indexRun(record: RunRecord): Result<void, RecorderError>;
  /** Newest first. */
  listRuns(opts?: ListRunsOptions): Result<RunRecord[], RecorderError>;
  getRun(id: string): Result<RunRecord, RecorderError>;
  close(): void;
};

const COLUMNS = [
  ["id", "id"],
  ["startedAt", "started_at"],
  ["endedAt", "ended_at"],
  ["taskId", "task_id"],
  ["instruction", "instruction"],
  ["startUrl", "start_url"],
  ["outcome", "outcome"],
  ["reason", "reason"],
  ["steps", "steps"],
  ["wallMs", "wall_ms"],
  ["costUsd", "cost_usd"],
  ["decisionCalls", "decision_calls"],
  ["modelCalls", "model_calls"],
  ["decisionModel", "decision_model"],
  ["gitSha", "git_sha"],
  ["folder", "folder"],
] as const satisfies ReadonlyArray<readonly [keyof RunRecord, string]>;

const SQL_COLUMNS = COLUMNS.map(([, c]) => c);
const UPSERT = `INSERT INTO runs (${SQL_COLUMNS.join(", ")})
  VALUES (${SQL_COLUMNS.map((c) => `:${c}`).join(", ")})
  ON CONFLICT(id) DO UPDATE SET ${SQL_COLUMNS.filter((c) => c !== "id")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ")}`;
const SELECT = `SELECT ${SQL_COLUMNS.join(", ")} FROM runs`;

const SqlValue = z.union([z.string(), z.number(), z.bigint().transform(Number), z.null()]);
const Row = z.record(z.string(), z.unknown());

function rowToRecord(row: unknown): Result<RunRecord, RecorderError> {
  const r = Row.safeParse(row);
  if (!r.success) return err({ kind: "corrupt", message: "index row is not an object" });
  const obj: Record<string, unknown> = {};
  for (const [key, col] of COLUMNS) {
    const v = SqlValue.safeParse(r.data[col]);
    obj[key] = v.success ? v.data : r.data[col];
  }
  const parsed = RunRecord.safeParse(obj);
  if (!parsed.success) return err({ kind: "corrupt", message: `index row invalid: ${parsed.error.message}` });
  return ok(parsed.data);
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get();
  const current = Number(row?.user_version ?? 0);
  if (current > MIGRATIONS.length) {
    throw new Error(`index schema version ${current} is newer than supported ${MIGRATIONS.length}`);
  }
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

/** Opens (creating and migrating if needed) `<runsDir>/index.sqlite`, or `opts.path` when given. */
export function openRunIndex(runsDir: string, opts: { path?: string } = {}): Result<RunIndex, RecorderError> {
  const path = opts.path ?? join(runsDir, INDEX_FILE);
  let db: DatabaseSync;
  try {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    migrate(db);
  } catch (e) {
    return err({ kind: "io", message: `cannot open run index at ${path}: ${message(e)}` });
  }

  const upsert = db.prepare(UPSERT);
  const byId = db.prepare(`${SELECT} WHERE id = ?`);
  const latest = db.prepare(`${SELECT} ORDER BY started_at DESC, id DESC LIMIT ?`);
  const latestForTask = db.prepare(`${SELECT} WHERE task_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`);

  const collect = (rows: unknown[]): Result<RunRecord[], RecorderError> => {
    const out: RunRecord[] = [];
    for (const row of rows) {
      const r = rowToRecord(row);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return ok(out);
  };

  return ok({
    path,
    indexRun(record) {
      const parsed = RunRecord.safeParse(record);
      if (!parsed.success)
        return err({ kind: "corrupt", message: `invalid run record: ${parsed.error.message}` });
      const params: Record<string, string | number | null> = {};
      for (const [key, col] of COLUMNS) params[col] = parsed.data[key];
      try {
        upsert.run(params);
        return ok(undefined);
      } catch (e) {
        return err({ kind: "io", message: `index write failed: ${message(e)}` });
      }
    },
    listRuns(opts = {}) {
      const limit = Math.max(1, Math.trunc(opts.limit ?? 50));
      try {
        const rows = opts.taskId === undefined ? latest.all(limit) : latestForTask.all(opts.taskId, limit);
        return collect(rows);
      } catch (e) {
        return err({ kind: "io", message: `index read failed: ${message(e)}` });
      }
    },
    getRun(id) {
      try {
        const row = byId.get(id);
        if (row === undefined) return err({ kind: "not_found", message: `run ${id} is not in the index` });
        return rowToRecord(row);
      } catch (e) {
        return err({ kind: "io", message: `index read failed: ${message(e)}` });
      }
    },
    close() {
      if (db.isOpen) db.close();
    },
  });
}
