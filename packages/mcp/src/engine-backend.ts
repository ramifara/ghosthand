// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// McpBackend over the engine: runs go through runAgent / runQaSpecFile exactly like the CLI, so they are
// recorded, indexed and replayable. Jev only (no planner or writer) to keep tool calls predictable.
import { readFileSync } from "node:fs";
import { HeuristicDecisionProvider } from "@ghosthand/core";
import type { WebComputer } from "@ghosthand/driver-playwright";
import {
  agentSecretNames,
  createDecisionProvider,
  type EngineRuntime,
  launchWeb,
  prepareTestbedRun,
  runAgent,
  runQaSpecFile,
  webLauncher,
} from "@ghosthand/engine";
import { type DecisionProvider, type FieldValue, type RunEvent, TaskSpec } from "@ghosthand/protocol";
import type { ActInput, BackendResult, McpBackend, ObservedElement } from "./mcp-backend.ts";

function progressLine(e: RunEvent): string | undefined {
  switch (e.type) {
    case "plan":
      return `plan: ${e.plan.subgoals.map((g) => g.id).join(" → ")}`;
    case "effect":
      return `step ${e.step}: ${e.result.effect}`;
    case "verify":
      return `verify ${e.state} (by ${e.decidedBy})`;
    case "escalate":
      return `escalate ${e.from} → ${e.to}: ${e.reason}`;
    case "run.end":
      return `${e.outcome}: ${e.reason} (${e.steps} steps, ${Math.round(e.wallMs)} ms)`;
    default:
      return undefined;
  }
}

export function createEngineBackend(rt: EngineRuntime): McpBackend {
  let session: WebComputer | undefined;

  const decisionFor = (choice: "jev" | "heuristic", capUsd: number): BackendResult<DecisionProvider> => {
    if (choice === "heuristic") return { ok: true, value: new HeuristicDecisionProvider() };
    const d = createDecisionProvider(rt, capUsd);
    return d.ok ? { ok: true, value: d.value } : { ok: false, error: d.error.message };
  };

  return {
    async runTask(input, ctx) {
      let task: TaskSpec;
      let oracle: ((id: string) => Promise<boolean | undefined>) | undefined;
      let cookies: Parameters<typeof webLauncher>[1]["cookies"] = [];
      if (input.taskId) {
        const prepared = await prepareTestbedRun(input.taskId);
        if (!prepared.ok) return { ok: false, error: prepared.error.message };
        for (const [name, value] of Object.entries(prepared.value.secrets)) rt.secrets.register(name, value);
        task = prepared.value.spec;
        if (input.url) task = { ...task, startUrl: new URL(new URL(task.startUrl).pathname, input.url).href };
        oracle = prepared.value.oracle;
        cookies = prepared.value.cookies;
      } else {
        const parsed = TaskSpec.safeParse({
          id: "adhoc",
          instruction: input.goal,
          startUrl: input.url,
          secrets: agentSecretNames(rt),
          budget: rt.config.budget,
        });
        if (!parsed.success) return { ok: false, error: `invalid task: ${parsed.error.message}` };
        task = parsed.data;
      }
      const decision = decisionFor(input.decision, task.budget.usd);
      if (!decision.ok) return decision;
      const report = await runAgent(rt, {
        task,
        decision: decision.value,
        launch: webLauncher(rt, {
          startUrl: task.startUrl,
          allowOrigins: task.allowOrigins,
          headless: input.headless,
          profile: "mcp",
          cookies,
        }),
        hooks: {
          ...(oracle ? { oracle } : {}),
          signal: ctx.signal,
          onEvent: (e) => {
            const line = progressLine(e);
            if (line) ctx.progress(line);
          },
        },
      });
      if (!report.ok) return { ok: false, error: report.error };
      const r = report.value;
      return {
        ok: true,
        value: {
          runId: r.runId,
          folder: r.folder,
          outcome: r.outcome,
          reason: r.reason,
          oraclePass: r.oraclePass ?? null,
          steps: r.result.steps,
          wallMs: r.result.wallMs,
          costUsd: "costUsd" in r.result ? r.result.costUsd : 0,
          decisionCalls: r.result.decisionCalls,
        },
      };
    },

    async runSpec(input, ctx) {
      const r = await runQaSpecFile(rt, {
        specPath: input.specPath,
        decision: input.decision,
        headless: input.headless,
        profile: "mcp",
        ...(input.runs ? { runs: input.runs } : {}),
        ...(input.variant ? { variant: input.variant } : {}),
        ...(input.out ? { out: input.out } : {}),
        onProgress: ctx.progress,
        signal: ctx.signal,
      });
      if (!r.ok) return { ok: false, error: r.error.message };
      const { report, htmlPath, jsonPath } = r.value;
      return {
        ok: true,
        value: {
          verdict: report.verdict,
          score: report.score,
          summaryLine: report.summaryLine,
          htmlPath,
          jsonPath,
          plantedBugs: report.plantedBugs.map((b) => ({ flag: b.flag, active: b.active, caught: b.caught })),
        },
      };
    },

    getStoredRun(runId) {
      const r = rt.index.getRun(runId);
      if (!r.ok) return { ok: false, error: r.error.message };
      const x = r.value;
      return {
        ok: true,
        value: {
          runId: x.id,
          folder: x.folder,
          taskId: x.taskId ?? null,
          outcome: x.outcome ?? null,
          steps: x.steps,
          costUsd: x.costUsd,
          startedAt: x.startedAt ?? null,
        },
      };
    },

    readReport(jsonPath) {
      try {
        return { ok: true, value: JSON.parse(readFileSync(jsonPath, "utf8")) as unknown };
      } catch (e) {
        return { ok: false, error: `cannot read ${jsonPath}: ${e instanceof Error ? e.message : String(e)}` };
      }
    },

    listRecipes: () => [],

    async observe(input) {
      if (!session) {
        if (!input.url) return { ok: false, error: "no session yet: give a url" };
        const launched = await launchWeb(rt, {
          startUrl: input.url,
          headless: input.headless,
          profile: "mcp-interactive",
        });
        if (!launched.ok) return { ok: false, error: launched.error.message };
        session = launched.value.computer;
      }
      if (input.url) {
        const opened = await session.open(input.url);
        if (!opened.ok) return { ok: false, error: `${opened.error.kind}: ${opened.error.message}` };
      }
      await session.waitIdle({ capMs: 5000 });
      const snap = await session.observe();
      if (!snap.ok) return { ok: false, error: `${snap.error.kind}: ${snap.error.message}` };
      const elements: ObservedElement[] = snap.value.elements.map((e) => ({
        id: e.token,
        role: e.role,
        name: e.name,
        ...(e.value !== undefined ? { value: e.value } : {}),
        ops: e.actions.filter((a) => a !== "scroll_into_view"),
      }));
      return { ok: true, value: { url: snap.value.url ?? "", title: snap.value.title, elements } };
    },

    async act(input: ActInput) {
      if (!session) return { ok: false, error: "no session: call observe with a url first" };
      let r: Awaited<ReturnType<WebComputer["press"]>>;
      switch (input.op) {
        case "press":
          r = await session.press(input.id);
          break;
        case "toggle":
          r = await session.toggle(input.id);
          break;
        case "focus":
          r = await session.focus(input.id);
          break;
        case "select_option":
          r = await session.selectOption(input.id, input.option);
          break;
        case "set_value": {
          const value: FieldValue = input.secret ? { secretRef: input.secret } : (input.text ?? "");
          r = await session.setValue(input.id, value);
          break;
        }
      }
      return {
        ok: true,
        value: {
          effect: r.effect,
          detail: r.error
            ? `${r.error.kind}: ${r.error.message}`
            : `${r.route}, ${Math.round(r.durationMs)} ms`,
        },
      };
    },

    async close() {
      await session?.close();
      session = undefined;
    },
  };
}
