// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { HeuristicDecisionProvider } from "@ghosthand/core";
import {
  createAssistants,
  createDecisionProvider,
  openRuntime,
  type PlannerChoice,
  type WriterChoice,
  webLauncher,
} from "@ghosthand/engine";
import { runSuite } from "@ghosthand/evals";
import type { DecisionProvider, TaskSpec } from "@ghosthand/protocol";
import { fail, out } from "../io.ts";

export interface EvalFlags {
  suite: string;
  n: number;
  only?: string[];
  headless: boolean;
  /** "jev" (default) or "heuristic" (plumbing smoke without a key). */
  decision: "jev" | "heuristic";
  out?: string;
  json: boolean;
  planner?: PlannerChoice;
  writer?: WriterChoice;
}

export async function evalCommand(flags: EvalFlags): Promise<number> {
  const opened = await openRuntime({ logLevel: "warn" });
  if (!opened.ok) return fail(opened.error.message);
  const rt = opened.value;
  let makeDecision: (task: TaskSpec) => DecisionProvider;
  if (flags.decision === "heuristic") makeDecision = createHeuristic;
  else {
    const probe = createDecisionProvider(rt, rt.config.budget.usd);
    if (!probe.ok) return fail(probe.error.message);
    // The decision cost meter's cap is the task's dollar budget, as for `ghosthand run`.
    makeDecision = (task) => {
      const d = createDecisionProvider(rt, task.budget.usd);
      if (!d.ok) throw new Error(d.error.message);
      return d.value;
    };
  }
  const assistants =
    flags.decision === "heuristic"
      ? undefined
      : await createAssistants(rt, { planner: flags.planner ?? "auto", writer: flags.writer ?? "auto" });
  if (assistants) process.stderr.write(`assistants: ${assistants.describe}\n`);
  const report = await runSuite(rt, {
    ...(assistants?.planner ? { planner: assistants.planner } : {}),
    ...(assistants?.writer ? { writer: assistants.writer } : {}),
    suite: flags.suite,
    n: flags.n,
    ...(flags.only ? { only: flags.only } : {}),
    ...(flags.out ? { outDir: flags.out } : {}),
    decision: makeDecision,
    launcherFor: (p) =>
      webLauncher(rt, {
        startUrl: p.spec.startUrl,
        allowOrigins: p.spec.allowOrigins,
        headless: flags.headless,
        profile: "evals",
        cookies: p.cookies,
      }),
    onRow: (row) =>
      process.stderr.write(
        `${row.task} #${row.attempt}: ${row.pass ? "PASS" : "fail"} (${row.outcome}, ${row.steps} steps, ${Math.round(row.wallMs)} ms)\n`,
      ),
  });
  await assistants?.close();
  if (!report.ok) return fail(report.error.message);
  out(
    flags.json
      ? JSON.stringify(report.value.summary, null, 2)
      : `${report.value.markdown}\nresults: ${report.value.outDir}`,
  );
  return 0;
}

const createHeuristic = () => new HeuristicDecisionProvider();
