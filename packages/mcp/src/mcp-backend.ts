// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// What the MCP tools need from the engine. The real backend is engine-backend.ts; tests use fakes.

export type DecisionChoice = "jev" | "heuristic";

export interface TaskRunInput {
  goal?: string;
  url?: string;
  /** Testbed task id (e.g. "l1-update-profile"); the testbed must be running. */
  taskId?: string;
  headless: boolean;
  decision: DecisionChoice;
}

export interface TaskRunSummary {
  runId: string;
  folder: string;
  outcome: string;
  reason: string;
  /** Testbed oracle verdict when the task is a testbed task. */
  oraclePass: boolean | null;
  steps: number;
  wallMs: number;
  costUsd: number;
  decisionCalls: number;
}

export interface SpecRunInput {
  specPath: string;
  runs?: number;
  decision: DecisionChoice;
  variant?: Record<string, string>;
  headless: boolean;
  out?: string;
}

export interface SpecRunSummary {
  verdict: string;
  score: number;
  summaryLine: string;
  htmlPath: string;
  jsonPath: string;
  plantedBugs: Array<{ flag: string; active: boolean; caught: boolean }>;
}

export interface StoredRun {
  runId: string;
  folder: string;
  taskId: string | null;
  outcome: string | null;
  steps: number;
  costUsd: number;
  startedAt: number | null;
}

/** One element of an interactive observation (optional observe/act tools). */
export interface ObservedElement {
  id: string;
  role: string;
  name: string;
  value?: string;
  ops: string[];
}

export type ActInput =
  | { op: "press" | "toggle" | "focus"; id: string }
  | { op: "set_value"; id: string; text?: string; secret?: string }
  | { op: "select_option"; id: string; option: string };

export type BackendResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface McpBackend {
  runTask(
    input: TaskRunInput,
    ctx: { signal: AbortSignal; progress: (line: string) => void },
  ): Promise<BackendResult<TaskRunSummary>>;
  runSpec(
    input: SpecRunInput,
    ctx: { signal: AbortSignal; progress: (line: string) => void },
  ): Promise<BackendResult<SpecRunSummary>>;
  /** A run from the run index (runs started outside this server too). */
  getStoredRun(runId: string): BackendResult<StoredRun>;
  /** Reads a report JSON written by runSpec. */
  readReport(jsonPath: string): BackendResult<unknown>;
  /** Recipes arrive with Phase 3 knowledge; until then the list is empty. */
  listRecipes(): Array<{ id: string; title: string }>;
  /** Interactive tools (behind a flag). */
  observe?(input: {
    url?: string;
    headless: boolean;
  }): Promise<BackendResult<{ url: string; title: string; elements: ObservedElement[] }>>;
  act?(input: ActInput): Promise<BackendResult<{ effect: string; detail: string }>>;
  close?(): Promise<void>;
}
