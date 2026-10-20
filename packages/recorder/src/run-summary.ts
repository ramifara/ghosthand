// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Folds a run's events into a RunSummary. run.end figures win over derived counts.
import type { RunEvent } from "@ghosthand/protocol";
import type { RunSummary } from "./run-record.ts";

export function emptySummary(id = "", startedAt = 0): RunSummary {
  return {
    id,
    startedAt,
    endedAt: null,
    taskId: null,
    instruction: null,
    startUrl: null,
    outcome: null,
    reason: null,
    steps: 0,
    wallMs: null,
    costUsd: 0,
    decisionCalls: 0,
    modelCalls: 0,
    decisionModel: null,
    gitSha: null,
    modeShares: null,
    eventCount: 0,
    imageTokens: 0,
    d0Steps: 0,
  };
}

/** Pure reducer: `events.reduce(foldSummary, emptySummary())`. */
export function foldSummary(acc: RunSummary, e: RunEvent): RunSummary {
  const s: RunSummary = { ...acc, eventCount: acc.eventCount + 1 };
  if (acc.eventCount === 0) {
    s.id = e.runId;
    s.startedAt = e.t;
  }
  if ("step" in e && typeof e.step === "number" && s.outcome === null) s.steps = Math.max(s.steps, e.step);
  switch (e.type) {
    case "run.start":
      s.id = e.runId;
      s.startedAt = e.t;
      s.taskId = e.task.id;
      s.instruction = e.task.instruction;
      s.startUrl = e.task.startUrl;
      s.decisionModel = e.decisionModel;
      s.gitSha = e.gitSha ?? null;
      break;
    case "decision.request":
      for (const img of e.images ?? []) s.imageTokens += img.tokens;
      break;
    case "action":
      if (e.mode === "D0") s.d0Steps += 1;
      break;
    case "decision.answer":
      if (s.outcome === null) {
        s.decisionCalls += 1;
        s.costUsd += e.costUsd;
      }
      break;
    case "model.call":
      if (s.outcome === null) {
        s.modelCalls += 1;
        s.costUsd += e.costUsd ?? 0;
      }
      break;
    case "run.end":
      s.endedAt = e.t;
      s.outcome = e.outcome;
      s.reason = e.reason;
      s.steps = e.steps;
      s.wallMs = e.wallMs;
      s.costUsd = e.costUsd;
      s.decisionCalls = e.decisionCalls;
      s.modelCalls = e.modelCalls;
      s.modeShares = e.modeShares;
      break;
    default:
      break;
  }
  if (s.outcome === null) s.wallMs = Math.max(0, e.t - s.startedAt);
  return s;
}

export function runSummary(events: readonly RunEvent[]): RunSummary {
  return events.reduce(foldSummary, emptySummary());
}
