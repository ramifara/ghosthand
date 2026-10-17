// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunEvent } from "@ghosthand/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actionsForReplay, parseEvents, readRun } from "./replay-reader.ts";
import { runSummary } from "./run-summary.ts";
import { tempDir } from "./test-support.ts";

const FIXTURE = join(import.meta.dirname, "__fixtures__", "events.jsonl");

let tmp: ReturnType<typeof tempDir>;
beforeEach(() => {
  tmp = tempDir();
});
afterEach(() => tmp.cleanup());

function fixtureRun(id = "r1"): string {
  const folder = join(tmp.dir, id);
  mkdirSync(folder);
  copyFileSync(FIXTURE, join(folder, "events.jsonl"));
  return folder;
}

function fixtureEvents(): RunEvent[] {
  const r = parseEvents(readFileSync(FIXTURE, "utf8"));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe("readRun", () => {
  it("reads the fixture by folder and by run id", () => {
    const folder = fixtureRun();
    const byFolder = readRun(folder);
    expect(byFolder.ok && byFolder.value.events.map((e) => e.type)).toEqual([
      "run.start",
      "observe",
      "decision.request",
      "decision.answer",
      "gate",
      "action",
      "effect",
      "verify",
      "step.end",
      "run.end",
    ]);
    const byId = readRun("r1", { runsDir: tmp.dir });
    expect(byId.ok && byId.value.folder).toBe(folder);
  });

  it("returns not_found for a missing run", () => {
    const r = readRun("missing", { runsDir: tmp.dir });
    expect(!r.ok && r.error.kind).toBe("not_found");
  });

  it("reports corrupt lines with line numbers", () => {
    const folder = fixtureRun();
    const lines = readFileSync(join(folder, "events.jsonl"), "utf8").trimEnd().split("\n");
    lines[2] = '{"t":3,"seq":2,"runId":"r1","type":"observe","step":"x"}';
    lines[5] = lines[5]?.slice(0, 20) ?? "";
    lines.push(lines[0] ?? ""); // seq goes backwards
    writeFileSync(join(folder, "events.jsonl"), `${lines.join("\n")}\n`);
    const r = readRun(folder);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("corrupt");
    expect(r.error.lines?.map((l) => l.line)).toEqual([3, 6, 11]);
    expect(r.error.message).toContain("line 3");
    expect(r.error.lines?.[1]?.message).toContain("invalid JSON");
    expect(r.error.lines?.[2]?.message).toContain("seq");
  });
});

describe("actionsForReplay", () => {
  it("returns confirmed actions with their target fingerprint", () => {
    expect(actionsForReplay(fixtureEvents())).toEqual([
      {
        step: 1,
        seq: 5,
        action: { type: "set_value", token: "e3", value: "alice@testbed.local" },
        target: { stableId: "textbox|Email|form:login", role: "textbox", name: "Email" },
        effect: "confirmed",
      },
    ]);
  });

  it("drops refused, no-op and unconfirmed actions and keeps partial/unverifiable", () => {
    const base = fixtureEvents();
    const action = base.find((e) => e.type === "action");
    const effect = base.find((e) => e.type === "effect");
    if (action?.type !== "action" || effect?.type !== "effect") throw new Error("fixture changed");
    const make = (
      step: number,
      outcome: "partial" | "unverifiable" | "suspected_noop" | "refused" | null,
    ) => {
      const out: RunEvent[] = [{ ...action, step, seq: step * 10 }];
      if (outcome)
        out.push({ ...effect, step, seq: step * 10 + 1, result: { ...effect.result, effect: outcome } });
      return out;
    };
    const events = [
      ...make(1, "partial"),
      ...make(2, "suspected_noop"),
      ...make(3, "refused"),
      ...make(4, null),
      ...make(5, "unverifiable"),
    ];
    expect(actionsForReplay(events).map((a) => [a.step, a.effect])).toEqual([
      [1, "partial"],
      [5, "unverifiable"],
    ]);
  });
});

describe("runSummary", () => {
  it("uses run.end figures when present", () => {
    expect(runSummary(fixtureEvents())).toEqual({
      id: "r1",
      startedAt: 1,
      endedAt: 10,
      taskId: "l1-login",
      instruction: "Sign in as alice",
      startUrl: "http://127.0.0.1:4400/login",
      outcome: "success",
      reason: "done_when satisfied",
      steps: 3,
      wallMs: 2400,
      costUsd: 0.00003,
      decisionCalls: 3,
      modelCalls: 0,
      decisionModel: "jev-1.13.0",
      gitSha: null,
      modeShares: { B: 1 },
      eventCount: 10,
    });
  });

  it("derives counts for an unfinished run", () => {
    const partial = fixtureEvents().filter((e) => e.type !== "run.end");
    expect(runSummary(partial)).toMatchObject({
      outcome: null,
      endedAt: null,
      steps: 1,
      decisionCalls: 1,
      costUsd: 0.00001,
      wallMs: 8,
      eventCount: 9,
    });
  });
});

describe("Jev 1.14 events", () => {
  it("parses a run with a ground request, a box answer and a D0 action", () => {
    const r = parseEvents(readFileSync(join(import.meta.dirname, "__fixtures__", "events-d0.jsonl"), "utf8"));
    expect(r.ok ? r.value.map((e) => e.type) : r.error).toEqual([
      "run.start",
      "observe",
      "decision.request",
      "decision.answer",
      "action",
      "step.end",
      "run.end",
    ]);
  });
});
