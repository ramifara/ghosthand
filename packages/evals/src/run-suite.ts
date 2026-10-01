// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Runs a suite N times against the testbed and writes results.jsonl + summary.md.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Planner, Writer } from "@ghosthand/core";
import {
  type ComputerLauncher,
  type EngineRuntime,
  gitSha,
  type PreparedTestbedRun,
  prepareTestbedRun,
  runAgent,
  type TestbedError,
} from "@ghosthand/engine";
import type { DecisionProvider, TaskSpec } from "@ghosthand/protocol";
import type { TestbedTask } from "@ghosthand/testbed-kit";
import { EvalRow } from "./eval-row.ts";
import { type SuiteError, selectTasks, taskRef } from "./suites.ts";
import { type EvalSummary, formatSummaryMarkdown, summarize } from "./summarize.ts";

export interface RunSuiteOptions {
  suite: string;
  n: number;
  only?: string[];
  mode?: "blind" | "source-aware";
  /** Where results go; default `<runsDir>/../evals/<timestamp>-<suite>`. */
  outDir?: string;
  /** Builds the decision provider for one run; its cost cap should be the task's dollar budget. */
  decision: (task: TaskSpec) => DecisionProvider;
  /** Builds a launcher for a prepared task (adds its cookies, allowlist, secrets). */
  launcherFor: (prepared: PreparedTestbedRun) => ComputerLauncher;
  prepare?: (
    taskId: string,
  ) => Promise<{ ok: true; value: PreparedTestbedRun } | { ok: false; error: TestbedError }>;
  tasks?: readonly TestbedTask[];
  onRow?: (row: EvalRow) => void;
  /** Mode C planner and writer hand-off (optional). */
  planner?: Planner;
  writer?: Writer;
}

export interface SuiteReport {
  outDir: string;
  rows: EvalRow[];
  summary: EvalSummary;
  markdown: string;
}

export async function runSuite(
  rt: EngineRuntime,
  opts: RunSuiteOptions,
): Promise<{ ok: true; value: SuiteReport } | { ok: false; error: SuiteError | TestbedError }> {
  const selected = selectTasks(opts.suite, {
    ...(opts.only ? { only: opts.only } : {}),
    ...(opts.tasks ? { tasks: opts.tasks } : {}),
  });
  if (!selected.ok) return selected;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const outDir = opts.outDir ?? join(rt.runsDir, "..", "evals", `${stamp}-${opts.suite}`);
  mkdirSync(outDir, { recursive: true });
  const resultsPath = join(outDir, "results.jsonl");
  const prepare = opts.prepare ?? ((id: string) => prepareTestbedRun(id));
  const sha = gitSha() ?? null;
  const rows: EvalRow[] = [];

  for (const task of selected.value) {
    for (let attempt = 1; attempt <= opts.n; attempt++) {
      const prepared = await prepare(task.id);
      if (!prepared.ok) return prepared;
      for (const [name, value] of Object.entries(prepared.value.secrets)) rt.secrets.register(name, value);
      const decision = opts.decision(prepared.value.spec);
      const run = await runAgent(rt, {
        task: prepared.value.spec,
        launch: opts.launcherFor(prepared.value),
        decision,
        ...(opts.planner ? { planner: opts.planner } : {}),
        ...(opts.writer ? { writer: opts.writer } : {}),
        hooks: { oracle: prepared.value.oracle },
      });
      const base = {
        suite: opts.suite,
        task: taskRef(task),
        attempt,
        mode: opts.mode ?? "blind",
        model: decision.id,
        decisionProvider: decision.id.split(":")[0] ?? decision.id,
        gitSha: sha,
      };
      const row: EvalRow = run.ok
        ? EvalRow.parse({
            ...base,
            runId: run.value.runId,
            outcome: run.value.outcome,
            // The oracle decides; the agent's own verdict only counts when no oracle answered.
            pass: run.value.oraclePass ?? run.value.outcome === "success",
            oraclePass: run.value.oraclePass ?? null,
            reason: run.value.reason,
            steps: run.value.result.steps,
            wallMs: run.value.result.wallMs,
            costUsd: "costUsd" in run.value.result ? run.value.result.costUsd : 0,
            decisionCalls: run.value.result.decisionCalls,
            modelCalls: "modelCalls" in run.value.result ? run.value.result.modelCalls : 0,
            modeShares: run.value.summary?.modeShares ?? {},
            timings: "timings" in run.value.result ? run.value.result.timings : [],
          })
        : EvalRow.parse({
            ...base,
            runId: null,
            outcome: "error",
            pass: false,
            oraclePass: null,
            reason: run.error,
            steps: 0,
            wallMs: 0,
            costUsd: 0,
            decisionCalls: 0,
            modelCalls: 0,
            modeShares: {},
            timings: [],
          });
      rows.push(row);
      appendFileSync(resultsPath, `${rt.secrets.redact(JSON.stringify(row))}\n`);
      opts.onRow?.(row);
    }
  }
  const summary = summarize(rows);
  const markdown = formatSummaryMarkdown(summary);
  writeFileSync(join(outDir, "summary.md"), markdown);
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return { ok: true, value: { outDir, rows, summary, markdown } };
}
