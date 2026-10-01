// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// What a case executor (the engine's web executor, or a fake in tests) hands back to the QA judge.
// QA sits below the engine, so running a case is injected; everything after that is pure.
import type {
  DecisionProvider,
  Predicate,
  Result,
  RunEvent,
  RunOutcome,
  Snapshot,
  TaskSpec,
} from "@ghosthand/protocol";
import type { ErrorLog } from "./qa-checks.ts";

/** The page as it was when a step ended (or after the case, for `final`). */
export interface Checkpoint {
  snapshot?: Snapshot;
  /** Screenshot bytes (PNG) and its file in the run folder. */
  screenshot?: Uint8Array;
  screenshotFile?: string;
  /** Small JPEG for the HTML report (inlined as a data URI). */
  thumbnail?: Uint8Array;
  /** Exact model input of the last act decision of the step (run-folder relative). */
  stateFile?: string;
  url?: string;
}

/** A `holds` verify request the loop sent, attributed to the subgoal that was running. */
export interface HoldsRecord {
  subgoalId: string | undefined;
  criteria: string;
  p: number | undefined;
  costUsd: number;
  inputTokens: number;
}

export type A11yImpact = "minor" | "moderate" | "serious" | "critical";

export interface A11yViolation {
  id: string;
  impact: A11yImpact | null;
  help: string;
  helpUrl: string;
  nodes: number;
}

export interface PageA11y {
  url: string;
  violations: A11yViolation[];
  error?: string;
}

export interface CaseChecks {
  oracle?: (taskId: string) => Promise<boolean | undefined>;
  http?: (p: Extract<Predicate, { kind: "http" }>) => Promise<boolean | undefined>;
}

export interface CaseExecution {
  runId?: string;
  /** Absolute run folder; evidence paths are relative to it. */
  folder?: string;
  outcome: RunOutcome;
  reason: string;
  events: RunEvent[];
  /** Keyed by subgoal id, taken when the subgoal ended. */
  checkpoints: Record<string, Checkpoint>;
  /** Fresh observation after the run, for case-level expects and the UX/visual reviews. */
  final?: Checkpoint;
  errors: ErrorLog;
  a11y: PageA11y[];
  holds: HoldsRecord[];
  wallMs: number;
  steps: number;
  costUsd: number;
  decisionCalls: number;
  modelCalls: number;
  inputTokens: number;
  checks: CaseChecks;
  /** Writes a JSON evidence file into the run folder; returns its relative path. */
  writeEvidence?: (name: string, data: unknown) => string | undefined;
}

export interface ExecuteCaseInput {
  caseId: string;
  task: TaskSpec;
  /** 1-based run number (pass^k). */
  run: number;
  decision: DecisionProvider;
  signal?: AbortSignal;
}

export type ExecuteError = { kind: "setup" | "launch" | "engine"; message: string };

export interface CaseExecutor {
  execute(input: ExecuteCaseInput): Promise<Result<CaseExecution, ExecuteError>>;
}
