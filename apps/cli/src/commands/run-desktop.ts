// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand run --surface x11|wayland|windows|macos (--task desktop-* | --app "<command>" "<goal>")`.
import {
  agentSecretNames,
  createAssistants,
  createDecisionProvider,
  type DesktopLaunchOptions,
  desktopLauncher,
  type EngineRuntime,
  openRuntime,
  prepareDesktopRun,
  runAgent,
} from "@ghosthand/engine";
import { TaskSpec } from "@ghosthand/protocol";
import { createApprover } from "../approve.ts";
import { fail, out } from "../io.ts";
import { progressPrinter } from "../progress.ts";
import type { RunFlags } from "./run-flags.ts";

export type DesktopSurfaceFlag = DesktopLaunchOptions["surface"];
export const DESKTOP_SURFACE_FLAGS: readonly DesktopSurfaceFlag[] = ["x11", "wayland", "windows", "macos"];

export async function runDesktopCommand(flags: RunFlags, surface: DesktopSurfaceFlag): Promise<number> {
  if (!flags.task && !flags.goal)
    return fail('give a desktop task (--task desktop-...) or a goal ("...")', 2);
  if (!flags.task && !flags.app) return fail("--app is required with a free-text desktop goal", 2);
  const opened = await openRuntime({ ...(flags.config ? { configPath: flags.config } : {}) });
  if (!opened.ok) return fail(opened.error.message);
  const rt: EngineRuntime = opened.value;
  for (const w of rt.warnings) process.stderr.write(`warn: ${w}\n`);

  let task: TaskSpec;
  let launch: DesktopLaunchOptions = {
    surface,
    ...(flags.runtime ? { runtime: flags.runtime } : {}),
    ...(flags.vncPort !== undefined ? { vncPort: flags.vncPort } : {}),
    ...(flags.network ? { network: true } : {}),
    ...(flags.allowHostDesktop ? { allowHostDesktop: true } : {}),
  };
  let oracle: ((id: string) => Promise<boolean | undefined>) | undefined;
  let verdict: (() => string | undefined) | undefined;
  if (flags.task) {
    const prepared = prepareDesktopRun(flags.task);
    if (!prepared.ok) return fail(prepared.error.message);
    task = prepared.value.spec;
    launch = { ...launch, ...prepared.value.launch };
    oracle = prepared.value.oracle;
    verdict = prepared.value.lastVerdict;
  } else {
    task = TaskSpec.parse({
      id: "adhoc",
      instruction: flags.goal,
      startUrl: "desktop:app",
      secrets: agentSecretNames(rt),
      budget: rt.config.budget,
    });
    launch = { ...launch, ...(flags.app ? { app: flags.app } : {}) };
  }
  const decision = createDecisionProvider(rt, task.budget.usd);
  if (!decision.ok) return fail(decision.error.message);
  const assistants = await createAssistants(rt, { planner: flags.planner, writer: flags.writer });
  if (!flags.json) process.stderr.write(`assistants: ${assistants.summary}\nsurface: ${surface}\n`);
  const report = await runAgent(rt, {
    ...(assistants.planner ? { planner: assistants.planner } : {}),
    ...(assistants.writer ? { writer: assistants.writer } : {}),
    assistants: assistants.summary,
    ...(flags.guidance ? { guidance: flags.guidance } : {}),
    task,
    decision: decision.value,
    trace: flags.trace,
    launch: desktopLauncher(rt, launch),
    hooks: {
      ...(oracle ? { oracle } : {}),
      approve: createApprover({ yes: flags.yes }),
      ...(flags.json ? {} : { onEvent: progressPrinter() }),
    },
  });
  await assistants.close();
  if (!report.ok) return fail(report.error);
  const r = report.value;
  const detail = verdict?.();
  if (flags.json)
    out(
      JSON.stringify(
        {
          runId: r.runId,
          folder: r.folder,
          surface,
          outcome: r.outcome,
          reason: r.reason,
          oraclePass: r.oraclePass,
          ...(detail ? { oracleDetail: detail } : {}),
          summary: r.summary,
        },
        null,
        2,
      ),
    );
  else {
    out(
      `run ${r.runId}: ${r.outcome}${r.oraclePass === undefined ? "" : ` · oracle ${r.oraclePass ? "pass" : "FAIL"}${detail ? ` (${detail})` : ""}`}`,
    );
    out(`folder ${r.folder}`);
  }
  const pass = r.oraclePass ?? r.outcome === "success";
  return pass ? 0 : 1;
}
