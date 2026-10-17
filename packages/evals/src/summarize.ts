// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { StepTiming } from "@ghosthand/protocol";
import type { EvalRow } from "./eval-row.ts";

export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

export const percentile = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? 0;
};

export const stepTotal = (t: StepTiming): number =>
  t.settleMs + t.observeMs + t.decideMs + t.actMs + t.verifyMs;

export interface TaskSummary {
  task: string;
  runs: number;
  passes: number;
  medianSteps: number;
  medianWallMs: number;
  meanCostUsd: number;
}

export interface EvalSummary {
  suite: string;
  runs: number;
  passes: number;
  tasks: TaskSummary[];
  steps: number;
  medianStepMs: number;
  p95StepMs: number;
  split: StepTiming;
  costUsd: number;
  costPerStepUsd: number;
  decisionCalls: number;
  modelCalls: number;
  /** LLM/consultant calls as a share of all model-ish calls. */
  llmShare: number;
  /** Screenshots sent to Jev (ADR 0020). */
  imageTokens: number;
  imageCostUsd: number;
  d0Steps: number;
  modeShares: Record<string, number>;
  gitSha: string | null;
  model: string;
}

export function summarize(rows: EvalRow[]): EvalSummary {
  const byTask = new Map<string, EvalRow[]>();
  for (const r of rows) byTask.set(r.task, [...(byTask.get(r.task) ?? []), r]);
  const timings = rows.flatMap((r) => r.timings);
  const steps = rows.reduce((a, r) => a + r.steps, 0);
  const costUsd = rows.reduce((a, r) => a + r.costUsd, 0);
  const decisionCalls = rows.reduce((a, r) => a + r.decisionCalls, 0);
  const modelCalls = rows.reduce((a, r) => a + r.modelCalls, 0);
  const modeSteps: Record<string, number> = {};
  for (const r of rows)
    for (const [m, share] of Object.entries(r.modeShares))
      modeSteps[m] = (modeSteps[m] ?? 0) + share * r.steps;
  const modeShares: Record<string, number> = {};
  for (const [m, n] of Object.entries(modeSteps)) modeShares[m] = steps > 0 ? n / steps : 0;
  const phase = (k: keyof StepTiming) =>
    median(timings.map((t) => t[k]).filter((v): v is number => v !== undefined));
  return {
    suite: rows[0]?.suite ?? "",
    runs: rows.length,
    passes: rows.filter((r) => r.pass).length,
    tasks: [...byTask].map(([task, rs]) => ({
      task,
      runs: rs.length,
      passes: rs.filter((r) => r.pass).length,
      medianSteps: median(rs.map((r) => r.steps)),
      medianWallMs: median(rs.map((r) => r.wallMs)),
      meanCostUsd: rs.reduce((a, r) => a + r.costUsd, 0) / rs.length,
    })),
    steps,
    medianStepMs: median(timings.map(stepTotal)),
    p95StepMs: percentile(timings.map(stepTotal), 95),
    split: {
      settleMs: phase("settleMs"),
      observeMs: phase("observeMs"),
      decideMs: phase("decideMs"),
      actMs: phase("actMs"),
      verifyMs: phase("verifyMs"),
    },
    costUsd,
    costPerStepUsd: steps > 0 ? costUsd / steps : 0,
    decisionCalls,
    modelCalls,
    llmShare: decisionCalls + modelCalls > 0 ? modelCalls / (decisionCalls + modelCalls) : 0,
    imageTokens: rows.reduce((a, r) => a + r.imageTokens, 0),
    imageCostUsd: rows.reduce((a, r) => a + r.imageCostUsd, 0),
    d0Steps: rows.reduce((a, r) => a + r.d0Steps, 0),
    modeShares,
    gitSha: rows[0]?.gitSha ?? null,
    model: rows[0]?.model ?? "",
  };
}

const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);
const usd = (n: number) => `$${n < 0.01 ? n.toFixed(6) : n.toFixed(4)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function formatSummaryMarkdown(s: EvalSummary): string {
  const lines = [
    `# Eval: ${s.suite}`,
    "",
    `Model \`${s.model}\`, git \`${s.gitSha ?? "unknown"}\`. ${s.passes}/${s.runs} runs passed (${pct(s.runs ? s.passes / s.runs : 0)}).`,
    "",
    "| Task | Pass | Median steps | Median wall | Mean cost |",
    "|---|---|---|---|---|",
    ...s.tasks.map(
      (t) =>
        `| \`${t.task}\` | ${t.passes}/${t.runs} | ${t.medianSteps} | ${ms(t.medianWallMs)} | ${usd(t.meanCostUsd)} |`,
    ),
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Steps | ${s.steps} |`,
    `| Median step / p95 | ${ms(s.medianStepMs)} / ${ms(s.p95StepMs)} |`,
    `| Median split (settle / observe / decide / act / verify) | ${ms(s.split.settleMs)} / ${ms(s.split.observeMs)} / ${ms(s.split.decideMs)} / ${ms(s.split.actMs)} / ${ms(s.split.verifyMs)} |`,
    `| Cost total / per step | ${usd(s.costUsd)} / ${usd(s.costPerStepUsd)} |`,
    `| Jev calls / LLM calls / LLM share | ${s.decisionCalls} / ${s.modelCalls} / ${pct(s.llmShare)} |`,
    `| Image tokens / image cost / D0 steps | ${s.imageTokens} / $${s.imageCostUsd.toFixed(5)} / ${s.d0Steps} |`,
    `| Who did the work | ${
      Object.entries(s.modeShares)
        .map(([m, v]) => `${m} ${pct(v)}`)
        .join(", ") || "-"
    } |`,
  ];
  return `${lines.join("\n")}\n`;
}
