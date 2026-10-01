// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INDEX_SCHEMA_VERSION, openRunIndex, type RunIndex } from "./run-index.ts";
import type { RunRecord } from "./run-record.ts";
import { tempDir } from "./test-support.ts";

let tmp: ReturnType<typeof tempDir>;
let index: RunIndex;
beforeEach(() => {
  tmp = tempDir();
  const r = openRunIndex(tmp.dir);
  if (!r.ok) throw new Error(r.error.message);
  index = r.value;
});
afterEach(() => {
  index.close();
  tmp.cleanup();
});

function record(id: string, startedAt: number, taskId: string | null = "l1-login"): RunRecord {
  return {
    id,
    startedAt,
    endedAt: null,
    taskId,
    instruction: "Sign in as alice",
    startUrl: "http://127.0.0.1:4400/login",
    outcome: null,
    reason: null,
    steps: 0,
    wallMs: null,
    costUsd: 0,
    decisionCalls: 0,
    modelCalls: 0,
    decisionModel: "jev-1.13.0",
    gitSha: null,
    folder: join(tmp.dir, id),
  };
}

describe("run index", () => {
  it("creates index.sqlite and records the schema version", () => {
    expect(index.path).toBe(join(tmp.dir, "index.sqlite"));
    const db = new DatabaseSync(index.path);
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(INDEX_SCHEMA_VERSION);
    db.close();
  });

  it("inserts on start and updates on finish", () => {
    expect(index.indexRun(record("r1", 100)).ok).toBe(true);
    const started = index.getRun("r1");
    expect(started.ok && started.value).toEqual(record("r1", 100));

    const finished: RunRecord = {
      ...record("r1", 100),
      endedAt: 2_500,
      outcome: "success",
      reason: "done_when satisfied",
      steps: 3,
      wallMs: 2_400,
      costUsd: 0.00003,
      decisionCalls: 3,
      modelCalls: 1,
      gitSha: "abc1234",
    };
    expect(index.indexRun(finished).ok).toBe(true);
    const row = index.getRun("r1");
    expect(row.ok && row.value).toEqual(finished);
    const all = index.listRuns();
    expect(all.ok && all.value.length).toBe(1);
  });

  it("lists newest first, with limit and task filter", () => {
    index.indexRun(record("a", 1));
    index.indexRun(record("b", 3, "l1-update-profile"));
    index.indexRun(record("c", 2));
    const all = index.listRuns();
    expect(all.ok && all.value.map((r) => r.id)).toEqual(["b", "c", "a"]);
    const limited = index.listRuns({ limit: 2 });
    expect(limited.ok && limited.value.map((r) => r.id)).toEqual(["b", "c"]);
    const task = index.listRuns({ taskId: "l1-login" });
    expect(task.ok && task.value.map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("returns not_found and rejects invalid records", () => {
    const missing = index.getRun("nope");
    expect(!missing.ok && missing.error.kind).toBe("not_found");
    const bad = index.indexRun({ ...record("x", 1), steps: -1 });
    expect(!bad.ok && bad.error.kind).toBe("corrupt");
  });

  it("reopens an existing index without re-running migrations", () => {
    index.indexRun(record("keep", 1));
    index.close();
    const again = openRunIndex(tmp.dir);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    index = again.value;
    const row = index.getRun("keep");
    expect(row.ok).toBe(true);
  });

  it("refuses an index from a newer schema", () => {
    index.close();
    const db = new DatabaseSync(join(tmp.dir, "index.sqlite"));
    db.exec(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION + 1}`);
    db.close();
    const r = openRunIndex(tmp.dir);
    expect(!r.ok && r.error.kind).toBe("io");
  });
});
