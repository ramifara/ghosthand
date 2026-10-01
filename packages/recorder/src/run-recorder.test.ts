// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RunEventDraft } from "@ghosthand/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRun } from "./replay-reader.ts";
import { RUN_ID_PATTERN } from "./run-id.ts";
import { openRunIndex } from "./run-index.ts";
import { createRunRecorder, type RunRecorder } from "./run-recorder.ts";
import { endDraft, readTree, startDraft, tempDir } from "./test-support.ts";

const SECRET = "s3cr3t-Value-42";
const redact = (text: string): string => text.split(SECRET).join("[input:TESTBED_PASSWORD]");

let tmp: ReturnType<typeof tempDir>;
beforeEach(() => {
  tmp = tempDir();
});
afterEach(() => tmp.cleanup());

function counterClock(start = 1_000): () => number {
  let now = start;
  return () => now++;
}

function open(runId = "run-a"): RunRecorder {
  const r = createRunRecorder({ runsDir: tmp.dir, runId, redact, clock: counterClock() });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const observe = (step: number): RunEventDraft => ({
  type: "observe",
  step,
  snapshotId: `s${step}`,
  elementCount: 3,
  tokenEstimate: 100,
});

describe("createRunRecorder", () => {
  it("creates the run folder layout", () => {
    const rec = open();
    expect(rec.paths.folder).toBe(join(tmp.dir, "run-a"));
    for (const d of [rec.paths.screenshotsDir, rec.paths.statesDir, rec.paths.videoDir]) {
      expect(statSync(d).isDirectory()).toBe(true);
    }
    expect(existsSync(rec.paths.events)).toBe(true);
    expect(rec.paths.trace).toBe(join(tmp.dir, "run-a", "trace.zip"));
    expect(rec.paths.log).toBe(join(tmp.dir, "run-a", "log.jsonl"));
    expect(rec.paths.otel).toBe(join(tmp.dir, "run-a", "otel.jsonl"));
  });

  it("generates a sortable run id when none is given", () => {
    const r = createRunRecorder({ runsDir: tmp.dir, redact });
    expect(r.ok && RUN_ID_PATTERN.test(r.value.runId)).toBe(true);
  });

  it("refuses unsafe run ids and existing runs", () => {
    expect(createRunRecorder({ runsDir: tmp.dir, runId: "../x", redact }).ok).toBe(false);
    open("dup");
    const again = createRunRecorder({ runsDir: tmp.dir, runId: "dup", redact });
    expect(again.ok).toBe(false);
  });

  it("assigns seq, t and runId in order under concurrent emits", async () => {
    const rec = open();
    expect(rec.emit(startDraft()).ok).toBe(true);
    const n = 60;
    await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        // Interleave across microtasks and macrotasks.
        if (i % 3 === 0) await new Promise((r) => setTimeout(r, i % 7));
        else await Promise.resolve();
        const res = rec.emit(observe(i + 1));
        expect(res.ok).toBe(true);
      }),
    );
    const lines = readFileSync(rec.paths.events, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(n + 1);
    const parsed = lines.map((l) => JSON.parse(l) as { seq: number; t: number; runId: string });
    parsed.forEach((e, i) => {
      expect(e.seq).toBe(i);
      expect(e.runId).toBe("run-a");
      if (i > 0) expect(e.t).toBeGreaterThan(parsed[i - 1]?.t ?? Number.POSITIVE_INFINITY);
    });
    const back = readRun(rec.paths.folder);
    expect(back.ok && back.value.events.length).toBe(n + 1);
  });

  it("rejects malformed drafts without writing or consuming a seq", () => {
    const rec = open();
    const bad = { type: "observe", step: "one", snapshotId: "s1" } as unknown as RunEventDraft;
    const res = rec.emit(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("corrupt");
      expect(res.error.message).toContain("observe");
    }
    expect(rec.emit({ type: "nope" } as unknown as RunEventDraft).ok).toBe(false);
    expect(readFileSync(rec.paths.events, "utf8")).toBe("");
    const good = rec.emit(observe(1));
    expect(good.ok && good.value.seq).toBe(0);
  });

  it("ignores t, seq and runId smuggled into a draft", () => {
    const rec = open();
    const draft = { ...observe(1), seq: 99, t: 5, runId: "evil" } as unknown as RunEventDraft;
    const res = rec.emit(draft);
    expect(res.ok && [res.value.seq, res.value.runId]).toEqual([0, "run-a"]);
  });

  it("applies redaction to events, states, summary and the index", () => {
    const idx = openRunIndex(tmp.dir);
    if (!idx.ok) throw new Error(idx.error.message);
    const r = createRunRecorder({ runsDir: tmp.dir, runId: "run-s", redact, index: idx.value });
    if (!r.ok) throw new Error(r.error.message);
    const rec = r.value;
    expect(rec.emit(startDraft(`Sign in with password ${SECRET}`)).ok).toBe(true);
    expect(
      rec.emit({ type: "model.call", role: "writer", model: "m", latencyMs: 1, ok: true, summary: SECRET })
        .ok,
    ).toBe(true);
    const state = rec.writeState(1, "act", {
      page: `field shows ${SECRET}`,
      password: "typed-literal-password",
      element: { token: "e12", name: "Password" },
    });
    expect(state.ok && state.value).toBe("step-001-act.json");
    expect(rec.writeScreenshot(1, new Uint8Array([0x89, 0x50, 0x4e, 0x47])).ok).toBe(true);
    expect(rec.emit(endDraft()).ok).toBe(true);
    const fin = rec.finish({ reason: `done (${SECRET})` });
    expect(fin.ok).toBe(true);
    idx.value.close();

    const files = readTree(tmp.dir);
    expect(files.map((f) => f.file)).toEqual(
      expect.arrayContaining([
        rec.paths.events,
        rec.paths.summary,
        join(rec.paths.statesDir, "step-001-act.json"),
        join(rec.paths.screenshotsDir, "step-001.png"),
        join(tmp.dir, "index.sqlite"),
      ]),
    );
    for (const f of files) expect(f.text.includes(SECRET), f.file).toBe(false);
    expect(readFileSync(rec.paths.events, "utf8")).toContain("[input:TESTBED_PASSWORD]");

    const stateJson = JSON.parse(readFileSync(join(rec.paths.statesDir, "step-001-act.json"), "utf8"));
    expect(stateJson).toEqual({
      page: "field shows [input:TESTBED_PASSWORD]",
      password: "[redacted]",
      element: { token: "e12", name: "Password" },
    });
  });

  it("refuses to write when redaction breaks the JSON", () => {
    const r = createRunRecorder({ runsDir: tmp.dir, runId: "run-b", redact: (t) => t.replace("{", "") });
    if (!r.ok) throw new Error(r.error.message);
    const res = r.value.emit(observe(1));
    expect(res.ok).toBe(false);
    expect(readFileSync(r.value.paths.events, "utf8")).toBe("");
  });

  it("finishes once: writes summary.json, updates the index and stops accepting events", () => {
    const idx = openRunIndex(tmp.dir);
    if (!idx.ok) throw new Error(idx.error.message);
    const r = createRunRecorder({
      runsDir: tmp.dir,
      runId: "run-f",
      redact,
      clock: counterClock(),
      index: idx.value,
    });
    if (!r.ok) throw new Error(r.error.message);
    const rec = r.value;
    rec.emit(startDraft());
    const started = idx.value.getRun("run-f");
    expect(started.ok && [started.value.outcome, started.value.endedAt]).toEqual([null, null]);

    rec.emit(observe(1));
    rec.emit(endDraft());
    const fin = rec.finish();
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;
    expect(fin.value).toMatchObject({
      id: "run-f",
      outcome: "success",
      steps: 1,
      eventCount: 3,
      taskId: "l1-login",
    });
    expect(JSON.parse(readFileSync(rec.paths.summary, "utf8"))).toEqual(fin.value);

    const row = idx.value.getRun("run-f");
    expect(row.ok && row.value).toMatchObject({
      outcome: "success",
      decisionCalls: 2,
      folder: rec.paths.folder,
    });
    expect(rec.finish()).toEqual(fin);
    expect(rec.emit(observe(2)).ok).toBe(false);
    idx.value.close();
  });
});
