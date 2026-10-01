// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { RunRecord } from "@ghosthand/recorder";

export function table(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) row.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.length)));
  return rows
    .map((row) =>
      row
        .map((c, i) => c.padEnd(widths[i] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

export const ms = (n: number | null | undefined): string =>
  n === null || n === undefined ? "-" : n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;

export const usd = (n: number): string =>
  n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(3)}`;

export function runsTable(runs: readonly RunRecord[]): string {
  if (runs.length === 0) return "No runs recorded yet.";
  return table([
    ["RUN", "TASK", "OUTCOME", "STEPS", "WALL", "COST", "JEV", "MODEL"],
    ...runs.map((r) => [
      r.id,
      r.taskId ?? "-",
      r.outcome ?? "running",
      String(r.steps),
      ms(r.wallMs),
      usd(r.costUsd),
      String(r.decisionCalls),
      r.decisionModel ?? "-",
    ]),
  ]);
}
