// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The QA report (JSON next to the HTML). Statuses and "which oracle decided" follow the research note
// (jev-web-repos.md, report format): code predicates → Jev → vision → inconclusive.
import { RunOutcome, VerifyState } from "@ghosthand/protocol";
import { z } from "zod";
import { StepFlag } from "./spec-schema.ts";

export const StepStatus = z.enum(["passed", "failed", "blocked", "inconclusive", "advisory"]);
export type StepStatus = z.infer<typeof StepStatus>;

export const DecidedBy = z.enum(["deterministic", "oracle", "jev", "vision", "none"]);
export type DecidedBy = z.infer<typeof DecidedBy>;

export const Verdict = z.enum(["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE"]);
export type Verdict = z.infer<typeof Verdict>;

export const ExpectResult = z.object({
  source: z.string(),
  line: z.number().int(),
  kind: z.enum(["loop", "qa", "http", "vision", "perform"]),
  state: VerifyState,
  decidedBy: DecidedBy,
  confidence: z.number().min(0).max(1).optional(),
  detail: z.string(),
});
export type ExpectResult = z.infer<typeof ExpectResult>;

export const Evidence = z.object({
  /** Run-folder relative screenshot file. */
  screenshotFile: z.string().optional(),
  /** Small inline thumbnail (data URI) for the HTML report. */
  thumbnail: z.string().optional(),
  /** Exact model inputs (run-folder relative). */
  modelInputs: z.array(z.string()).default([]),
  url: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const StepResult = z.object({
  index: z.number().int(),
  line: z.number().int(),
  perform: z.string(),
  flag: StepFlag,
  decisive: z.boolean(),
  status: StepStatus,
  decidedBy: DecidedBy,
  confidence: z.number().min(0).max(1).optional(),
  detail: z.string(),
  expects: z.array(ExpectResult),
  evidence: Evidence,
  agentSteps: z.number().int().nonnegative(),
  wallMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
});
export type StepResult = z.infer<typeof StepResult>;

export const UxScore = z.object({
  key: z.string(),
  question: z.string(),
  /** 0..1, worst to best. */
  score: z.number().min(0).max(1).optional(),
  level: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  detail: z.string(),
});
export type UxScore = z.infer<typeof UxScore>;

export const CaseRun = z.object({
  run: z.number().int().positive(),
  runId: z.string().optional(),
  folder: z.string().optional(),
  outcome: RunOutcome,
  reason: z.string(),
  verdict: Verdict,
  steps: z.array(StepResult),
  caseExpects: z.array(ExpectResult),
  wallMs: z.number().nonnegative(),
  agentSteps: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  decisionCalls: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative(),
  consoleErrors: z.array(z.string()),
  httpErrors: z.array(z.object({ status: z.number().int(), url: z.string(), method: z.string().optional() })),
  a11y: z.array(
    z.object({
      url: z.string(),
      error: z.string().optional(),
      violations: z.array(
        z.object({
          id: z.string(),
          impact: z.enum(["minor", "moderate", "serious", "critical"]).nullable(),
          help: z.string(),
          helpUrl: z.string(),
          nodes: z.number().int(),
        }),
      ),
    }),
  ),
  ux: z.array(UxScore),
  visual: z
    .object({ score: z.number().min(0).max(1), issues: z.array(z.string()), model: z.string() })
    .optional(),
  finalEvidence: Evidence.optional(),
});
export type CaseRun = z.infer<typeof CaseRun>;

export const CaseResult = z.object({
  id: z.string(),
  suite: z.string(),
  title: z.string(),
  line: z.number().int(),
  notes: z.array(z.string()),
  verdict: Verdict,
  /** Runs that passed / runs. */
  passes: z.number().int().nonnegative(),
  runs: z.array(CaseRun),
  preflight: z.object({
    flags: z.array(StepFlag),
    actions: z.array(z.number().int()),
    answered: z.boolean(),
    costUsd: z.number().nonnegative(),
    error: z.string().optional(),
  }),
});
export type CaseResult = z.infer<typeof CaseResult>;

export const RubricItem = z.object({
  key: z.enum(["success", "reliability", "efficiency", "ux", "bugs", "accessibility", "visual"]),
  label: z.string(),
  weight: z.number(),
  /** Points earned (0..weight); undefined when not measured. */
  points: z.number().optional(),
  detail: z.string(),
});
export type RubricItem = z.infer<typeof RubricItem>;

export const PlantedBug = z.object({
  flag: z.string(),
  active: z.boolean(),
  expectedCase: z.string(),
  /** Runs of that case that failed (the bug was caught). */
  caughtRuns: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  caught: z.boolean(),
  decidedBy: DecidedBy.optional(),
});
export type PlantedBug = z.infer<typeof PlantedBug>;

export const QaReport = z.object({
  version: z.literal(1),
  spec: z.object({ path: z.string().optional(), url: z.string(), suites: z.array(z.string()) }),
  startedAt: z.string(),
  finishedAt: z.string(),
  decisionModel: z.string(),
  visionModel: z.string().optional(),
  runsPerCase: z.number().int().positive(),
  variant: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  verdict: Verdict,
  /** Overall score 0..100 over measured rubric items (task success is also a gate on the verdict). */
  score: z.number().min(0).max(100),
  rubric: z.array(RubricItem),
  cases: z.array(CaseResult),
  plantedBugs: z.array(PlantedBug),
  totals: z.object({
    wallMs: z.number().nonnegative(),
    costUsd: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    decisionCalls: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
  }),
  /** One line for calling agents: verdict, decisive counts, what to look at. */
  summaryLine: z.string(),
});
export type QaReport = z.infer<typeof QaReport>;
