// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import {
  agentSecretNames,
  createAssistants,
  createDecisionProvider,
  type EngineRuntime,
  isDesktopTask,
  openRuntime,
  prepareTestbedRun,
  runAgent,
  webLauncher,
} from "@ghosthand/engine";
import { TaskSpec } from "@ghosthand/protocol";
import { createApprover } from "../approve.ts";
import { fail, out } from "../io.ts";
import { progressPrinter } from "../progress.ts";
import { runDesktopCommand } from "./run-desktop.ts";
import type { RunFlags } from "./run-flags.ts";

/** Origins the browser may navigate to: the task's allowlist plus every `--allow-origin`, deduplicated. */
export function launchOrigins(task: Pick<TaskSpec, "allowOrigins">, extra: readonly string[]): string[] {
  return [...new Set([...task.allowOrigins, ...extra])];
}

export async function runCommand(flags: RunFlags): Promise<number> {
  const surface = flags.surface ?? (flags.task !== undefined && isDesktopTask(flags.task) ? "x11" : "web");
  if (surface !== "web") return runDesktopCommand(flags, surface);
  if (!flags.task && !flags.goal) return fail('give a testbed task (--task <id>) or a goal ("...")', 2);
  if (!flags.task && !flags.url) return fail("--url is required with a free-text goal", 2);
  const opened = await openRuntime({ ...(flags.config ? { configPath: flags.config } : {}) });
  if (!opened.ok) return fail(opened.error.message);
  const rt: EngineRuntime = opened.value;
  for (const w of rt.warnings) process.stderr.write(`warn: ${w}\n`);

  let task: TaskSpec;
  let oracle: ((id: string) => Promise<boolean | undefined>) | undefined;
  let cookies: Parameters<typeof webLauncher>[1]["cookies"] = [];
  if (flags.task) {
    const prepared = await prepareTestbedRun(flags.task);
    if (!prepared.ok) return fail(prepared.error.message);
    for (const [name, value] of Object.entries(prepared.value.secrets)) rt.secrets.register(name, value);
    task = prepared.value.spec;
    if (flags.url) task = { ...task, startUrl: new URL(new URL(task.startUrl).pathname, flags.url).href };
    oracle = prepared.value.oracle;
    cookies = prepared.value.cookies;
  } else {
    task = TaskSpec.parse({
      id: "adhoc",
      instruction: flags.goal,
      startUrl: flags.url,
      allowOrigins: flags.allowOrigins,
      secrets: agentSecretNames(rt),
      budget: rt.config.budget,
    });
  }
  const decision = createDecisionProvider(rt, task.budget.usd);
  if (!decision.ok) return fail(decision.error.message);

  const assistants = await createAssistants(rt, { planner: flags.planner, writer: flags.writer });
  if (!flags.json) process.stderr.write(`assistants: ${assistants.describe}\n`);
  const report = await runAgent(rt, {
    ...(assistants.planner ? { planner: assistants.planner } : {}),
    ...(assistants.writer ? { writer: assistants.writer } : {}),
    task,
    decision: decision.value,
    trace: flags.trace,
    launch: webLauncher(rt, {
      startUrl: task.startUrl,
      allowOrigins: launchOrigins(task, flags.allowOrigins),
      ...(flags.profile ? { profile: flags.profile } : {}),
      headless: flags.headless,
      cookies,
    }),
    hooks: {
      ...(oracle ? { oracle } : {}),
      approve: createApprover({ yes: flags.yes }),
      ...(flags.json ? {} : { onEvent: progressPrinter() }),
    },
  });
  await assistants.close();
  if (!report.ok) return fail(report.error);
  const r = report.value;
  if (flags.json)
    out(
      JSON.stringify(
        {
          runId: r.runId,
          folder: r.folder,
          outcome: r.outcome,
          reason: r.reason,
          oraclePass: r.oraclePass,
          summary: r.summary,
        },
        null,
        2,
      ),
    );
  else {
    out(
      `run ${r.runId}: ${r.outcome}${r.oraclePass === undefined ? "" : ` · oracle ${r.oraclePass ? "pass" : "FAIL"}`}`,
    );
    out(`folder ${r.folder}`);
    if ("answer" in r.result && r.result.answer !== undefined)
      out(`answer (${r.result.answeredBy}): ${r.result.answer}`);
  }
  const pass = r.oraclePass ?? r.outcome === "success";
  return pass ? 0 : 1;
}
