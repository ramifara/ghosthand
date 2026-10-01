// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import {
  createDecisionProvider,
  openRuntime,
  prepareTestbedRun,
  runReplay,
  testbedTaskIds,
  webLauncher,
} from "@ghosthand/engine";
import { actionsForReplay, readRun } from "@ghosthand/recorder";
import { fail, out } from "../io.ts";
import { progressPrinter } from "../progress.ts";

export async function replayCommand(
  runId: string | undefined,
  flags: { headless: boolean; profile?: string; json: boolean; heal: boolean },
): Promise<number> {
  if (!runId) return fail("usage: ghosthand replay <runId>", 2);
  const opened = await openRuntime();
  if (!opened.ok) return fail(opened.error.message);
  const rt = opened.value;
  const log = readRun(runId, { runsDir: rt.runsDir });
  if (!log.ok) return fail(log.error.message);
  const start = log.value.events.find((e) => e.type === "run.start");
  if (start?.type !== "run.start") return fail(`run ${runId} has no run.start event`);
  let task = start.task;
  const steps = actionsForReplay(log.value.events).map((a) => ({
    step: a.step,
    action: a.action,
    target: a.target ?? null,
  }));
  let oracle: ((id: string) => Promise<boolean | undefined>) | undefined;
  let cookies: Parameters<typeof webLauncher>[1]["cookies"] = [];
  if (testbedTaskIds().includes(task.id)) {
    // Same starting state as the recorded run: reset, seed, sign in.
    const prepared = await prepareTestbedRun(task.id);
    if (!prepared.ok) return fail(prepared.error.message);
    for (const [name, value] of Object.entries(prepared.value.secrets)) rt.secrets.register(name, value);
    oracle = prepared.value.oracle;
    cookies = prepared.value.cookies;
    task = { ...task, plan: prepared.value.spec.plan ?? task.plan };
  }
  const decision = flags.heal ? createDecisionProvider(rt, 0.05) : undefined;
  const report = await runReplay(rt, {
    task,
    steps,
    replayOf: runId,
    ...(decision?.ok ? { decision: decision.value } : {}),
    launch: webLauncher(rt, {
      startUrl: task.startUrl,
      allowOrigins: task.allowOrigins,
      ...(flags.profile ? { profile: flags.profile } : {}),
      headless: flags.headless,
      cookies,
    }),
    hooks: { ...(oracle ? { oracle } : {}), ...(flags.json ? {} : { onEvent: progressPrinter() }) },
  });
  if (!report.ok) return fail(report.error);
  const r = report.value;
  out(
    flags.json
      ? JSON.stringify(
          {
            runId: r.runId,
            outcome: r.outcome,
            reason: r.reason,
            oraclePass: r.oraclePass,
            decisionCalls: r.result.decisionCalls,
          },
          null,
          2,
        )
      : `replay ${r.runId} of ${runId}: ${r.outcome} · ${r.result.decisionCalls} decision calls${r.oraclePass === undefined ? "" : ` · oracle ${r.oraclePass ? "pass" : "FAIL"}`}`,
  );
  return (r.oraclePass ?? r.outcome === "success") ? 0 : 1;
}
