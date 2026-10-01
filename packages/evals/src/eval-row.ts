// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { RunOutcome, StepTiming } from "@ghosthand/protocol";
import { z } from "zod";

/** One JSONL row per (task, attempt). */
export const EvalRow = z.object({
  suite: z.string(),
  task: z.string(),
  attempt: z.number().int().positive(),
  mode: z.enum(["blind", "source-aware"]),
  model: z.string(),
  decisionProvider: z.string(),
  gitSha: z.string().nullable(),
  runId: z.string().nullable(),
  outcome: RunOutcome,
  pass: z.boolean(),
  oraclePass: z.boolean().nullable(),
  reason: z.string(),
  steps: z.number().int().nonnegative(),
  wallMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  decisionCalls: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative(),
  modeShares: z.record(z.string(), z.number()),
  timings: z.array(StepTiming),
});
export type EvalRow = z.infer<typeof EvalRow>;
