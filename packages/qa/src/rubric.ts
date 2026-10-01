// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Rubric (plan §7 Phase 5): task success 40 (also a gate on the verdict), reliability 10 (pass^k over N
// runs), efficiency 10 (steps and time against the budget), UX friction 15 (Jev scores, never decisive),
// bugs 10 (console errors, 5xx), accessibility 10 (axe), visual 5 (vision reviewer). Items that were not
// measured are left out and the score is scaled over the measured weight.
import type { A11yImpact } from "./case-execution.ts";
import type { CaseResult, CaseRun, RubricItem, Verdict } from "./report-schema.ts";
import type { QaBudget } from "./spec-schema.ts";

export const RUBRIC_WEIGHTS = {
  success: 40,
  reliability: 10,
  efficiency: 10,
  ux: 15,
  bugs: 10,
  accessibility: 10,
  visual: 5,
} as const;

const IMPACT_WEIGHT: Record<A11yImpact, number> = { minor: 1, moderate: 2, serious: 3, critical: 4 };
/** Weighted distinct axe violations that take accessibility to 0. */
export const A11Y_ZERO_AT = 20;
export const CONSOLE_ERROR_COST = 2;
export const SERVER_ERROR_COST = 5;

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const round = (n: number): number => Math.round(n * 10) / 10;

/** pass^k for one case: the chance that k runs drawn from the n observed all pass, C(c,k)/C(n,k). */
export function passHatK(passes: number, n: number, k: number = n): number {
  if (n === 0 || k > n) return 0;
  let p = 1;
  for (let i = 0; i < k; i++) p *= (passes - i) / (n - i);
  return Math.max(0, p);
}

export function runEfficiency(run: CaseRun, budget: QaBudget): number {
  if (run.verdict !== "PASS") return 0;
  const steps = Math.min(1, run.agentSteps / budget.steps);
  const time = Math.min(1, run.wallMs / 1000 / budget.seconds);
  return Math.max(0, 1 - 0.5 * steps - 0.5 * time);
}

export function computeRubric(cases: CaseResult[], budget: QaBudget): { items: RubricItem[]; score: number } {
  const runs = cases.flatMap((c) => c.runs);
  const items: RubricItem[] = [];
  const passRate = runs.length === 0 ? 0 : runs.filter((r) => r.verdict === "PASS").length / runs.length;
  items.push({
    key: "success",
    label: "Task success (gate)",
    weight: RUBRIC_WEIGHTS.success,
    points: round(RUBRIC_WEIGHTS.success * passRate),
    detail: `${runs.filter((r) => r.verdict === "PASS").length}/${runs.length} case runs passed every decisive step`,
  });
  const k = Math.max(1, ...cases.map((c) => c.runs.length));
  const phk = mean(cases.map((c) => passHatK(c.passes, c.runs.length)));
  items.push({
    key: "reliability",
    label: `Reliability (pass^${k})`,
    weight: RUBRIC_WEIGHTS.reliability,
    points: round(RUBRIC_WEIGHTS.reliability * phk),
    detail: `mean pass^k over ${cases.length} case(s) with ${k} run(s) each: ${phk.toFixed(2)}`,
  });
  const eff = mean(runs.map((r) => runEfficiency(r, budget)));
  items.push({
    key: "efficiency",
    label: "Efficiency",
    weight: RUBRIC_WEIGHTS.efficiency,
    points: round(RUBRIC_WEIGHTS.efficiency * eff),
    detail: `median ${median(runs.map((r) => r.agentSteps))} agent steps / budget ${budget.steps}; median ${(median(runs.map((r) => r.wallMs)) / 1000).toFixed(1)} s / budget ${budget.seconds} s`,
  });
  const ux = runs.flatMap((r) => r.ux.map((u) => u.score).filter((s): s is number => s !== undefined));
  items.push({
    key: "ux",
    label: "UX friction (Jev score, advisory)",
    weight: RUBRIC_WEIGHTS.ux,
    ...(ux.length > 0 ? { points: round(RUBRIC_WEIGHTS.ux * mean(ux)) } : {}),
    detail:
      ux.length > 0
        ? `mean of ${ux.length} score answer(s): ${mean(ux).toFixed(2)}`
        : "not measured (no score answers)",
  });
  const consoleErrors = new Set(runs.flatMap((r) => r.consoleErrors));
  const serverErrors = new Set(
    runs.flatMap((r) => r.httpErrors.filter((h) => h.status >= 500).map((h) => `${h.status} ${h.url}`)),
  );
  const bugCost = consoleErrors.size * CONSOLE_ERROR_COST + serverErrors.size * SERVER_ERROR_COST;
  items.push({
    key: "bugs",
    label: "Bugs (console errors, 5xx)",
    weight: RUBRIC_WEIGHTS.bugs,
    points: Math.max(0, RUBRIC_WEIGHTS.bugs - bugCost),
    detail: `${consoleErrors.size} distinct console error(s), ${serverErrors.size} distinct 5xx response(s)`,
  });
  const audited = runs.flatMap((r) => r.a11y).filter((p) => p.error === undefined);
  const distinct = new Map<string, A11yImpact | null>();
  for (const page of audited) for (const v of page.violations) distinct.set(v.id, v.impact);
  const weighted = [...distinct.values()].reduce((a, i) => a + (i ? IMPACT_WEIGHT[i] : 1), 0);
  items.push({
    key: "accessibility",
    label: "Accessibility (axe-core)",
    weight: RUBRIC_WEIGHTS.accessibility,
    ...(audited.length > 0
      ? { points: round(RUBRIC_WEIGHTS.accessibility * Math.max(0, 1 - weighted / A11Y_ZERO_AT)) }
      : {}),
    detail:
      audited.length > 0
        ? `${distinct.size} distinct rule(s) violated on ${new Set(audited.map((p) => p.url)).size} page(s); impact-weighted ${weighted}`
        : "not measured",
  });
  const visual = runs.map((r) => r.visual?.score).filter((s): s is number => s !== undefined);
  items.push({
    key: "visual",
    label: "Visual (vision reviewer)",
    weight: RUBRIC_WEIGHTS.visual,
    ...(visual.length > 0 ? { points: round(RUBRIC_WEIGHTS.visual * mean(visual)) } : {}),
    detail:
      visual.length > 0
        ? `mean visual score ${mean(visual).toFixed(2)}`
        : "not measured (no vision reviewer)",
  });
  const measured = items.filter((i) => i.points !== undefined);
  const weight = measured.reduce((a, i) => a + i.weight, 0);
  const points = measured.reduce((a, i) => a + (i.points ?? 0), 0);
  return { items, score: weight === 0 ? 0 : round((100 * points) / weight) };
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** Verdict over decisive steps and case expects. */
export function runVerdict(statuses: Array<{ status: string; decisive: boolean }>): Verdict {
  const decisive = statuses.filter((s) => s.decisive);
  if (decisive.some((s) => s.status === "failed")) return "FAIL";
  if (decisive.some((s) => s.status === "blocked")) return "BLOCKED";
  if (decisive.some((s) => s.status === "inconclusive")) return "INCONCLUSIVE";
  return "PASS";
}

/** A case's verdict over its runs: any failing run fails it. */
export function caseVerdict(runs: CaseRun[]): Verdict {
  if (runs.some((r) => r.verdict === "FAIL")) return "FAIL";
  if (runs.some((r) => r.verdict === "BLOCKED")) return "BLOCKED";
  if (runs.some((r) => r.verdict === "INCONCLUSIVE")) return "INCONCLUSIVE";
  return "PASS";
}
