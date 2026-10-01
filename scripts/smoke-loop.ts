// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Plumbing smoke test on the live testbed with the rule-based HeuristicDecisionProvider instead of Jev:
// real browser, real observe/act/settle, recorder, oracle, then a replay with zero decision calls.
// Needs `bun run dev:testbed` running. No API key, no network beyond 127.0.0.1.
import { HeuristicDecisionProvider } from "@ghosthand/core";
import { openRuntime, prepareTestbedRun, runAgent, runReplay, webLauncher } from "@ghosthand/engine";
import { actionsForReplay, readRun } from "@ghosthand/recorder";

const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const taskIds = ids.length > 0 ? ids : ["l1-login", "l1-update-profile"];
const headless = !process.argv.includes("--headed");

const rt = await openRuntime({ logLevel: "warn" });
if (!rt.ok) throw new Error(rt.error.message);
let failures = 0;
for (const id of taskIds) {
  const prepared = await prepareTestbedRun(id);
  if (!prepared.ok) throw new Error(prepared.error.message);
  for (const [k, v] of Object.entries(prepared.value.secrets)) rt.value.secrets.register(k, v);
  const spec = prepared.value.spec;
  const launch = webLauncher(rt.value, {
    startUrl: spec.startUrl,
    allowOrigins: spec.allowOrigins,
    headless,
    profile: "smoke",
    cookies: prepared.value.cookies,
  });
  const run = await runAgent(rt.value, {
    task: spec,
    launch,
    decision: new HeuristicDecisionProvider(),
    hooks: { oracle: prepared.value.oracle },
  });
  if (!run.ok) throw new Error(run.error);
  const r = run.value;
  const steps = "timings" in r.result ? r.result.timings : [];
  const total = steps
    .map((t) => t.settleMs + t.observeMs + t.decideMs + t.actMs + t.verifyMs)
    .sort((a, b) => a - b);
  console.log(
    `${id}: ${r.outcome} (${r.reason}) oracle=${r.oraclePass} steps=${r.result.steps} median step=${Math.round(total[Math.floor(total.length / 2)] ?? 0)}ms run=${r.runId}`,
  );

  const again = await prepareTestbedRun(id);
  if (!again.ok) throw new Error(again.error.message);
  const log = readRun(r.runId, { runsDir: rt.value.runsDir });
  if (!log.ok) throw new Error(log.error.message);
  const replaySteps = actionsForReplay(log.value.events).map((a) => ({
    step: a.step,
    action: a.action,
    target: a.target ?? null,
  }));
  const rep = await runReplay(rt.value, {
    task: spec,
    steps: replaySteps,
    replayOf: r.runId,
    launch: webLauncher(rt.value, {
      startUrl: spec.startUrl,
      allowOrigins: spec.allowOrigins,
      headless,
      profile: "smoke",
      cookies: again.value.cookies,
    }),
    hooks: { oracle: again.value.oracle },
  });
  if (!rep.ok) throw new Error(rep.error);
  console.log(
    `  replay: ${rep.value.outcome} oracle=${rep.value.oraclePass} decisionCalls=${rep.value.result.decisionCalls} wall=${Math.round(rep.value.result.wallMs)}ms`,
  );
  if (!r.oraclePass || !rep.value.oraclePass) failures++;
}
process.exitCode = failures > 0 ? 1 : 0;
