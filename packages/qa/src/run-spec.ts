// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Runs a parsed spec: preflight each case once, compile it, execute it N times through the injected
// executor, judge every step, review UX and visuals, then score the rubric and build the report.
import type { DecisionProvider } from "@ghosthand/protocol";
import type { CaseExecution, CaseExecutor, Checkpoint } from "./case-execution.ts";
import { compileCase } from "./compile-spec.ts";
import { judgeCaseExpects, judgeStep } from "./judge.ts";
import { listCases } from "./parse-spec.ts";
import { preflightCase } from "./preflight.ts";
import type {
  CaseResult,
  CaseRun,
  DecidedBy,
  Evidence,
  PlantedBug,
  QaReport,
  StepResult,
} from "./report-schema.ts";
import { caseVerdict, computeRubric, runVerdict } from "./rubric.ts";
import type { QaSpec } from "./spec-schema.ts";
import { reviewUx } from "./ux-review.ts";
import type { VisionJudge } from "./vision-judge.ts";

export type Scalar = string | number | boolean;

export interface RunSpecOptions {
  spec: QaSpec;
  executor: CaseExecutor;
  /** A fresh provider per case run (rule-based stand-ins keep per-run state). */
  decision: () => DecisionProvider;
  vision?: VisionJudge;
  /** Overrides front-matter `runs`. */
  runs?: number;
  /** Effective testbed variant (front-matter plus overrides), for the planted-bug section. */
  variant?: Record<string, Scalar>;
  /** Case ids to run (default all). */
  only?: string[];
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
  now?: () => Date;
}

export const dataUri = (bytes: Uint8Array | undefined, mediaType = "image/jpeg"): string | undefined =>
  bytes && bytes.length > 0 ? `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}` : undefined;

function evidenceOf(cp: Checkpoint | undefined): Evidence | undefined {
  if (!cp) return undefined;
  const thumb = dataUri(cp.thumbnail);
  return {
    ...(cp.screenshotFile ? { screenshotFile: cp.screenshotFile } : {}),
    ...(thumb ? { thumbnail: thumb } : {}),
    ...(cp.url ? { url: cp.url } : {}),
    modelInputs: cp.stateFile ? [cp.stateFile] : [],
  };
}

export async function runSpec(opts: RunSpecOptions): Promise<QaReport> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const fm = opts.spec.frontMatter;
  const runsPerCase = opts.runs ?? fm.runs;
  const log = opts.onProgress ?? (() => {});
  const cases: CaseResult[] = [];
  let decisionModel = "";

  for (const { suite, case: qaCase, id } of listCases(opts.spec)) {
    if (opts.only && !opts.only.includes(id)) continue;
    if (opts.signal?.aborted) break;
    const preDecision = opts.decision();
    decisionModel ||= preDecision.id;
    const pre = await preflightCase(qaCase, preDecision, opts.signal ? { signal: opts.signal } : {});
    log(
      `${suite.title} / ${qaCase.title}: preflight ${pre.steps.map((s, i) => `${i + 1}:${s.flag}×${s.actions}`).join(" ")}${pre.error ? ` (${pre.error})` : ""}`,
    );
    const compiled = compileCase(opts.spec, qaCase, id, pre);
    const runs: CaseRun[] = [];
    for (let run = 1; run <= runsPerCase; run++) {
      if (opts.signal?.aborted) break;
      const decision = opts.decision();
      const executed = await opts.executor.execute({
        caseId: id,
        task: compiled.task,
        run,
        decision,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      let caseRun: CaseRun;
      if (!executed.ok) {
        caseRun = blockedRun(
          run,
          `${executed.error.kind}: ${executed.error.message}`,
          compiled.steps,
          qaCase.steps,
        );
      } else {
        caseRun = await judgeRun(run, executed.value, compiled, qaCase, decision, opts);
      }
      runs.push(caseRun);
      log(
        `  run ${run}: ${caseRun.verdict} (${caseRun.outcome}, ${caseRun.agentSteps} steps, ${(caseRun.wallMs / 1000).toFixed(1)} s)${caseRun.runId ? ` run ${caseRun.runId}` : ""}`,
      );
    }
    cases.push({
      id,
      suite: suite.title,
      title: qaCase.title,
      line: qaCase.line,
      notes: [...suite.notes, ...qaCase.notes],
      verdict: runs.length === 0 ? "BLOCKED" : caseVerdict(runs),
      passes: runs.filter((r) => r.verdict === "PASS").length,
      runs,
      preflight: {
        flags: pre.steps.map((s) => s.flag),
        actions: pre.steps.map((s) => s.actions),
        answered: pre.steps.every((s) => s.answered),
        costUsd: pre.costUsd,
        ...(pre.error ? { error: pre.error } : {}),
      },
    });
  }

  const rubric = computeRubric(cases, fm.budget);
  const variant = opts.variant ?? fm.testbed?.variant ?? {};
  const plantedBugs = plantedBugReport(fm.planted_bugs, variant, cases);
  const allRuns = cases.flatMap((c) => c.runs);
  const verdict = cases.length === 0 ? "BLOCKED" : caseVerdict(allRuns);
  const totals = {
    wallMs: sum(allRuns.map((r) => r.wallMs)),
    costUsd: sum(allRuns.map((r) => r.costUsd)) + sum(cases.map((c) => c.preflight.costUsd)),
    inputTokens: sum(allRuns.map((r) => r.inputTokens)),
    decisionCalls: sum(allRuns.map((r) => r.decisionCalls)),
    modelCalls: sum(allRuns.map((r) => r.modelCalls)),
  };
  return {
    version: 1,
    spec: {
      ...(opts.spec.path ? { path: opts.spec.path } : {}),
      url: fm.url,
      suites: opts.spec.suites.map((s) => s.title),
    },
    startedAt,
    finishedAt: now().toISOString(),
    decisionModel,
    ...(opts.vision ? { visionModel: opts.vision.id } : {}),
    runsPerCase,
    variant,
    verdict,
    score: rubric.score,
    rubric: rubric.items,
    cases,
    plantedBugs,
    totals,
    summaryLine: summaryLine(verdict, cases, rubric.score),
  };
}

async function judgeRun(
  run: number,
  exec: CaseExecution,
  compiled: ReturnType<typeof compileCase>,
  qaCase: QaSpec["suites"][number]["cases"][number],
  decision: DecisionProvider,
  opts: RunSpecOptions,
): Promise<CaseRun> {
  const deps = {
    decision,
    ...(opts.vision ? { vision: opts.vision } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
  const steps: StepResult[] = [];
  let judgeCost = 0;
  let judgeTokens = 0;
  for (const [i, step] of compiled.steps.entries()) {
    const line = qaCase.steps[i]?.line ?? qaCase.line;
    const { result: judged, spend } = await judgeStep({ ...step, line }, exec, deps);
    judgeCost += spend.costUsd;
    judgeTokens += spend.inputTokens;
    const thumb = dataUri(
      exec.checkpoints[step.subgoalId]?.thumbnail ??
        (judged.status === "blocked" ? undefined : exec.final?.thumbnail),
    );
    steps.push(thumb ? { ...judged, evidence: { ...judged.evidence, thumbnail: thumb } } : judged);
  }
  const flow = qaCase.steps.map((s) => `${s.index}. ${s.perform}`);
  const caseExpects = await judgeCaseExpects(compiled.expects, exec, deps, `QA case "${qaCase.title}"`);
  const ux = await reviewUx(decision, exec.final?.snapshot, flow, opts.signal ? { signal: opts.signal } : {});
  let visual: CaseRun["visual"];
  let visionCost = 0;
  if (opts.vision && exec.final?.screenshot) {
    const r = await opts.vision.rate({
      image: { data: exec.final.screenshot, mediaType: "image/png" },
      context: `Final screen of QA case "${qaCase.title}": ${flow.join(" ")}`,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (r.ok) {
      visual = { score: r.value.score, issues: r.value.issues, model: r.value.model };
      visionCost = r.value.costUsd;
    }
  }
  const verdict = runVerdict([
    ...steps.map((s) => ({ status: s.status, decisive: s.decisive })),
    ...caseExpects.results.map((e) => ({
      status: e.state === "satisfied" ? "passed" : e.state === "unsatisfied" ? "failed" : "inconclusive",
      decisive: true,
    })),
  ]);
  const finalEvidence = evidenceOf(exec.final);
  return {
    run,
    ...(exec.runId ? { runId: exec.runId } : {}),
    ...(exec.folder ? { folder: exec.folder } : {}),
    outcome: exec.outcome,
    reason: exec.reason,
    verdict,
    steps,
    caseExpects: caseExpects.results,
    wallMs: exec.wallMs,
    agentSteps: exec.steps,
    costUsd: exec.costUsd + judgeCost + caseExpects.costUsd + ux.costUsd + visionCost,
    inputTokens: exec.inputTokens + judgeTokens + caseExpects.inputTokens + ux.inputTokens,
    decisionCalls: exec.decisionCalls,
    modelCalls: exec.modelCalls,
    consoleErrors: [...exec.errors.consoleErrors],
    httpErrors: exec.errors.httpErrors.map((h) => ({ status: h.status, url: h.url })),
    a11y: exec.a11y,
    ux: ux.scores,
    ...(visual ? { visual } : {}),
    ...(finalEvidence ? { finalEvidence } : {}),
  };
}

function blockedRun(
  run: number,
  reason: string,
  compiledSteps: ReturnType<typeof compileCase>["steps"],
  specSteps: QaSpec["suites"][number]["cases"][number]["steps"],
): CaseRun {
  return {
    run,
    outcome: "error",
    reason,
    verdict: "BLOCKED",
    steps: compiledSteps.map((s, i) => ({
      index: s.index,
      line: specSteps[i]?.line ?? 0,
      perform: s.perform,
      flag: s.flag,
      decisive: s.decisive,
      status: "blocked",
      decidedBy: "none",
      detail: reason,
      expects: [],
      evidence: { modelInputs: [] },
      agentSteps: 0,
      wallMs: 0,
      costUsd: 0,
      inputTokens: 0,
    })),
    caseExpects: [],
    wallMs: 0,
    agentSteps: 0,
    costUsd: 0,
    inputTokens: 0,
    decisionCalls: 0,
    modelCalls: 0,
    consoleErrors: [],
    httpErrors: [],
    a11y: [],
    ux: [],
  };
}

function plantedBugReport(
  planted: Record<string, string>,
  variant: Record<string, Scalar>,
  cases: CaseResult[],
): PlantedBug[] {
  return Object.entries(planted).map(([flag, title]) => {
    const c = cases.find((x) => x.title.toLowerCase() === title.toLowerCase());
    const failing = c?.runs.filter((r) => r.verdict === "FAIL") ?? [];
    const firstFailedStep = failing[0]?.steps.find((s) => s.status === "failed");
    const firstFailedExpect = failing[0]?.caseExpects.find((e) => e.state === "unsatisfied");
    const decidedBy: DecidedBy | undefined = firstFailedStep?.decidedBy ?? firstFailedExpect?.decidedBy;
    const active = Object.values(variant).some((v) => String(v) === flag);
    return {
      flag,
      active,
      expectedCase: title,
      caughtRuns: failing.length,
      runs: c?.runs.length ?? 0,
      caught: active && c !== undefined && c.runs.length > 0 && failing.length === c.runs.length,
      ...(decidedBy ? { decidedBy } : {}),
    };
  });
}

function summaryLine(verdict: QaReport["verdict"], cases: CaseResult[], score: number): string {
  const steps = cases.flatMap((c) => c.runs.flatMap((r) => r.steps.map((s) => ({ c, r, s }))));
  const decisive = steps.filter((x) => x.s.decisive);
  const passed = decisive.filter((x) => x.s.status === "passed").length;
  const failed = decisive
    .filter((x) => x.s.status === "failed")
    .map((x) => `${x.c.title}#${x.r.run} step ${x.s.index} (${x.s.decidedBy})`);
  const review = steps
    .filter((x) => x.s.status === "inconclusive")
    .map((x) => `${x.c.title}#${x.r.run} step ${x.s.index}`);
  const advisory = steps.filter((x) => x.s.status === "advisory").length;
  const parts = [`[qa] verdict ${verdict}: ${passed} of ${decisive.length} decisive steps passed`];
  if (failed.length > 0) parts.push(`failed: ${failed.slice(0, 5).join(", ")}`);
  if (review.length > 0) parts.push(`for you to judge: ${review.slice(0, 5).join(", ")}`);
  if (advisory > 0) parts.push(`advisory, not decisive: ${advisory}`);
  parts.push(`score ${score}/100`);
  return parts.join("; ");
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
