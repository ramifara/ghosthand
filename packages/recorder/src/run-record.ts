// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The per-run summary (summary.json) and the index row derived from it.
import { RunOutcome } from "@ghosthand/protocol";
import { z } from "zod";

const count = z.number().int().nonnegative();

/** Fields shared by summary.json and the `runs` table. Unknown values are null, never absent. */
const RunFields = {
  id: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().nullable(),
  taskId: z.string().nullable(),
  instruction: z.string().nullable(),
  startUrl: z.string().nullable(),
  outcome: RunOutcome.nullable(),
  reason: z.string().nullable(),
  steps: count,
  wallMs: z.number().nonnegative().nullable(),
  costUsd: z.number().nonnegative(),
  decisionCalls: count,
  modelCalls: count,
  decisionModel: z.string().nullable(),
  gitSha: z.string().nullable(),
};

export const RunSummary = z.object({
  ...RunFields,
  /** "Who did the work": share of steps per router mode, from run.end. */
  modeShares: z.record(z.string(), z.number()).nullable(),
  eventCount: count,
});
export type RunSummary = z.infer<typeof RunSummary>;

export const RunRecord = z.object({ ...RunFields, folder: z.string().min(1) });
export type RunRecord = z.infer<typeof RunRecord>;

export function toRunRecord(summary: RunSummary, folder: string): RunRecord {
  const { modeShares: _shares, eventCount: _count, ...fields } = summary;
  return { ...fields, folder };
}
