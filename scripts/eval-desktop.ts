// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Desktop testbed eval with real Jev (paid; never in CI): runs each desktop task N times on a desktop surface
// and prints pass rate, steps, cost and the per-step timing split. Planner and writer are off (Jev only).
//   node scripts/eval-desktop.ts [--surface x11|wayland] [--n 5] [--only desktop-list,...]
import { parseArgs } from "node:util";
import {
  createDecisionProvider,
  desktopLauncher,
  desktopTaskIds,
  openRuntime,
  prepareDesktopRun,
  runAgent,
} from "@ghosthand/engine";

const { values } = parseArgs({
  options: {
    surface: { type: "string", default: "x11" },
    n: { type: "string", default: "5" },
    only: { type: "string" },
    "max-usd": { type: "string", default: "0.5" },
  },
});
const surface = values.surface === "wayland" ? "wayland" : "x11";
const n = Number(values.n);
const maxUsd = Number(values["max-usd"]);
const ids = values.only ? values.only.split(",") : desktopTaskIds();

const rt = await openRuntime({ logLevel: "warn" });
if (!rt.ok) throw new Error(rt.error.message);

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};

interface Row {
  task: string;
  pass: number;
  runs: number;
  steps: number[];
  wallMs: number[];
  usd: number;
  stepMs: number[];
  observeMs: number[];
  decideMs: number[];
  actMs: number[];
  settleMs: number[];
  verifyMs: number[];
}

let spent = 0;
const rows: Row[] = [];
outer: for (const id of ids) {
  const row: Row = {
    task: id,
    pass: 0,
    runs: 0,
    steps: [],
    wallMs: [],
    usd: 0,
    stepMs: [],
    observeMs: [],
    decideMs: [],
    actMs: [],
    settleMs: [],
    verifyMs: [],
  };
  rows.push(row);
  for (let i = 0; i < n; i++) {
    if (spent >= maxUsd) {
      process.stderr.write(`budget cap $${maxUsd} reached\n`);
      break outer;
    }
    const prepared = prepareDesktopRun(id);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const decision = createDecisionProvider(rt.value, prepared.value.spec.budget.usd);
    if (!decision.ok) throw new Error(decision.error.message);
    const run = await runAgent(rt.value, {
      task: prepared.value.spec,
      decision: decision.value,
      trace: false,
      launch: desktopLauncher(rt.value, { surface, ...prepared.value.launch }),
      hooks: { oracle: prepared.value.oracle, approve: async () => true },
    });
    if (!run.ok) throw new Error(run.error);
    const r = run.value;
    const res = r.result;
    row.runs++;
    if (r.oraclePass) row.pass++;
    row.steps.push(res.steps);
    row.wallMs.push(res.wallMs);
    row.usd += res.costUsd;
    spent += res.costUsd;
    if ("timings" in res)
      for (const t of res.timings) {
        row.stepMs.push(t.settleMs + t.observeMs + t.decideMs + t.actMs + t.verifyMs);
        row.observeMs.push(t.observeMs);
        row.decideMs.push(t.decideMs);
        row.actMs.push(t.actMs);
        row.settleMs.push(t.settleMs);
        row.verifyMs.push(t.verifyMs);
      }
    process.stderr.write(
      `${id} #${i + 1}: ${r.outcome} · oracle ${r.oraclePass ? "pass" : "FAIL"} (${prepared.value.lastVerdict() ?? ""}) · ${res.steps} steps · ${(res.wallMs / 1000).toFixed(1)}s · $${res.costUsd.toFixed(5)} · ${r.runId}\n`,
    );
  }
}

const all = (k: keyof Pick<Row, "stepMs" | "observeMs" | "decideMs" | "actMs" | "settleMs" | "verifyMs">) =>
  rows.flatMap((r) => r[k]);
console.log(`\nDesktop eval on ${surface}, Jev only, n=${n}\n`);
console.log("| task | pass | median steps | median wall s | cost $ |");
console.log("|---|---|---|---|---|");
for (const r of rows)
  console.log(
    `| ${r.task} | ${r.pass}/${r.runs} | ${pct(r.steps, 50)} | ${(pct(r.wallMs, 50) / 1000).toFixed(1)} | ${r.usd.toFixed(4)} |`,
  );
console.log("\n| per step (ms) | p50 | p95 |");
console.log("|---|---|---|");
for (const k of ["stepMs", "settleMs", "observeMs", "decideMs", "actMs", "verifyMs"] as const)
  console.log(`| ${k.replace("Ms", "")} | ${pct(all(k), 50)} | ${pct(all(k), 95)} |`);
console.log(`\ntotal cost $${spent.toFixed(4)}`);
