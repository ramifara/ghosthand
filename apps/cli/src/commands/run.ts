// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import {
  agentSecretNames,
  createAssistants,
  createDecisionProvider,
  type EngineRuntime,
  isDesktopTask,
  loadEnvFile,
  openRuntime,
  prepareTestbedRun,
  runAgent,
  TESTBED_UPLOADS_DIR,
  webLauncher,
} from "@ghosthand/engine";
import { TaskSpec } from "@ghosthand/protocol";
import { createApprover } from "../approve.ts";
import { fail, out } from "../io.ts";
import { progressPrinter } from "../progress.ts";
import { setupRunExtras } from "../run-extras.ts";
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
  const opened = await openRuntime({
    ...(flags.config ? { configPath: flags.config } : {}),
    ...(flags.browserBehavior ? { overrides: { browser: { behavior: flags.browserBehavior } } } : {}),
  });
  if (!opened.ok) return fail(opened.error.message);
  const rt: EngineRuntime = opened.value;
  for (const w of rt.warnings) process.stderr.write(`warn: ${w}\n`);

  // Credentials for this run: registered as secrets, typed by the driver, shown to models as [input:NAME].
  const credNames: string[] = [];
  if (flags.creds) {
    const creds = loadEnvFile(flags.creds);
    if (!creds.ok) return fail(`--creds: ${creds.error.message}`);
    if (creds.value.values.size === 0) return fail(`--creds: no KEY=value lines in ${flags.creds}`);
    for (const [name, value] of creds.value.values) {
      if (!value) continue;
      rt.secrets.register(name, value);
      credNames.push(name);
    }
  }

  let task: TaskSpec;
  let oracle: ((id: string) => Promise<boolean | undefined>) | undefined;
  let cookies: Parameters<typeof webLauncher>[1]["cookies"] = [];
  if (flags.task) {
    const prepared = await prepareTestbedRun(flags.task);
    if (!prepared.ok) return fail(prepared.error.message);
    for (const [name, value] of Object.entries(prepared.value.secrets)) rt.secrets.register(name, value);
    task = { ...prepared.value.spec, secrets: [...new Set([...prepared.value.spec.secrets, ...credNames])] };
    if (flags.url) task = { ...task, startUrl: new URL(new URL(task.startUrl).pathname, flags.url).href };
    oracle = prepared.value.oracle;
    cookies = prepared.value.cookies;
  } else {
    task = TaskSpec.parse({
      id: "adhoc",
      instruction: flags.goal,
      startUrl: flags.url,
      allowOrigins: flags.allowOrigins,
      secrets: agentSecretNames(rt, credNames),
      budget: rt.config.budget,
    });
  }
  const decision = createDecisionProvider(rt, task.budget.usd);
  if (!decision.ok) return fail(decision.error.message);

  const assistants = await createAssistants(rt, { planner: flags.planner, writer: flags.writer });
  if (!flags.json) process.stderr.write(`assistants: ${assistants.summary}\n`);
  const extras = await setupRunExtras(rt, flags.extras);
  if (!extras.ok) return fail(extras.error);
  if (!flags.json) process.stderr.write(`knowledge: ${extras.value.describe}\n`);
  const loop = extras.value.loopFor(task);
  const report = await runAgent(rt, {
    ...(extras.value.knowledge ? { knowledge: extras.value.knowledge } : {}),
    ...(loop ? { loop } : {}),
    ...(assistants.planner ? { planner: assistants.planner } : {}),
    ...(assistants.writer ? { writer: assistants.writer } : {}),
    assistants: assistants.summary,
    ...(flags.guidance ? { guidance: flags.guidance } : {}),
    task,
    decision: decision.value,
    trace: flags.trace,
    autonomy: flags.unattended ? "unattended" : "supervised",
    launch: webLauncher(rt, {
      startUrl: task.startUrl,
      allowOrigins: launchOrigins(task, flags.allowOrigins),
      ...(flags.profile ? { profile: flags.profile } : {}),
      headless: flags.headless,
      cookies,
      ...(flags.task ? { uploadDir: TESTBED_UPLOADS_DIR } : {}),
    }),
    hooks: {
      ...(oracle ? { oracle } : {}),
      approve: createApprover({ yes: flags.yes }),
      ...(flags.json ? {} : { onEvent: progressPrinter() }),
    },
  });
  await assistants.close();
  extras.value.close();
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
    const k = r.knowledge;
    if (k?.recipeUsed)
      out(
        `recipe ${k.recipeUsed.recipeId} v${k.recipeUsed.version}: replayed ${k.recipeUsed.replayed}/${k.recipeUsed.total}${k.recipeUsed.heals.length ? `, healed ${k.recipeUsed.heals.length}` : ""}${k.recipeUsed.fellBackAt !== undefined ? `, fell back to B at step ${k.recipeUsed.fellBackAt + 1}` : ""}`,
      );
    if (k?.learned)
      out(`learned recipe ${k.learned.id} v${k.learned.version}${k.learned.created ? " (new)" : ""}`);
  }
  const pass = r.oraclePass ?? r.outcome === "success";
  return pass ? 0 : 1;
}
