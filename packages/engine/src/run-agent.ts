// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Run lifecycle: recorder + tracing + per-run log around the core loop (mode B) or a replay (mode A).
import {
  type ApprovalRequest,
  type EventSink,
  type LoopDeps,
  type Planner,
  type RunControl,
  type RunResult,
  runTask,
  type Writer,
} from "@ghosthand/core";
import type {
  Computer,
  DecisionProvider,
  RunEvent,
  RunEventDraft,
  RunOutcome,
  TaskSpec,
} from "@ghosthand/protocol";
import { createRunRecorder, type RunRecorder, type RunSummary, screenshotName } from "@ghosthand/recorder";
import { createFileLogger } from "./create-logger.ts";
import { afterRun, type KnowledgeOptions, type KnowledgeOutcome } from "./knowledge-run.ts";
import { type ReplayResult, type ReplayStep, replayRun } from "./replay.ts";
import { type EngineRuntime, gitSha } from "./runtime.ts";
import { createRunTracing, type RunTracing } from "./tracing.ts";

export interface LaunchedComputer {
  computer: Computer;
  /** Short description for run.start (e.g. "chrome 151 / profile default"). */
  surface: string;
  close(): Promise<void>;
}

export type ComputerLauncher = () => Promise<
  { ok: true; value: LaunchedComputer } | { ok: false; error: { message: string } }
>;

export interface RunHooks {
  /** Grades the run; receives the agent's reported answer for answer tasks. */
  oracle?: (taskId: string, answer?: string) => Promise<boolean | undefined>;
  approve?: (req: ApprovalRequest) => Promise<boolean>;
  onEvent?: (event: RunEvent) => void;
  signal?: AbortSignal;
  /** Takeover pause/resume (desktop). */
  control?: RunControl;
}

export interface RunReport {
  runId: string;
  folder: string;
  outcome: RunOutcome;
  reason: string;
  summary: RunSummary | undefined;
  /** Result of the task oracle after the run (testbed tasks), independent of the agent's own verdict. */
  oraclePass: boolean | undefined;
  result: RunResult | ReplayResult;
  /** Recipe used, recipe learned, app-map rows (when knowledge is enabled). */
  knowledge?: KnowledgeOutcome;
}

/** Recorder, tracing and per-run log for one run folder. */
export interface RunSession {
  recorder: RunRecorder;
  tracing: RunTracing;
  sink: EventSink;
  flushLog: () => void;
  errors: string[];
}

export function openSession(
  rt: EngineRuntime,
  hooks: RunHooks,
): { ok: true; value: RunSession } | { ok: false; error: string } {
  const redact = (text: string) => rt.secrets.redact(text);
  const rec = createRunRecorder({ runsDir: rt.runsDir, redact, index: rt.index });
  if (!rec.ok) return { ok: false, error: rec.error.message };
  const recorder = rec.value;
  const tracing = createRunTracing(recorder.paths.otel, redact);
  const { logger, flush } = createFileLogger(recorder.paths.log, rt.secrets);
  const errors: string[] = [];
  const sink: EventSink = {
    emit(draft: RunEventDraft) {
      const r = recorder.emit(draft);
      if (!r.ok) {
        errors.push(r.error.message);
        logger.error({ kind: r.error.kind }, r.error.message);
        return;
      }
      logger.debug({ type: r.value.type, seq: r.value.seq }, "event");
      tracing.onEvent(r.value);
      hooks.onEvent?.(r.value);
    },
    screenshotName: (step) => screenshotName(step),
    writeScreenshot(step, bytes) {
      const r = recorder.writeScreenshot(step, bytes);
      return r.ok ? r.value : "";
    },
    writeState(step, purpose, state) {
      const r = recorder.writeState(step, purpose, state);
      return r.ok ? r.value : "";
    },
  };
  return { ok: true, value: { recorder, tracing, sink, flushLog: flush, errors } };
}

export async function closeSession(
  s: RunSession,
  launched: LaunchedComputer | undefined,
): Promise<RunSummary | undefined> {
  if (launched) {
    await launched.computer.stopRecording();
    await launched.close();
  }
  await s.tracing.shutdown();
  s.flushLog();
  const fin = s.recorder.finish();
  return fin.ok ? fin.value : undefined;
}

export interface AgentRunOptions {
  task: TaskSpec;
  launch: ComputerLauncher;
  decision: DecisionProvider;
  hooks?: RunHooks;
  /** Record a Playwright trace into the run folder. */
  trace?: boolean;
  /** Mode C: plans when the task has none and replans failed subgoals. */
  planner?: Planner;
  /** Writer hand-off when Jev is unsure. */
  writer?: Writer;
  /** App map and recipes (mode A, learning). */
  knowledge?: KnowledgeOptions;
  /** Extra loop dependencies (vision assist, source-aware seeding, plan refinement). */
  loop?: AgentLoopExtras;
}

/** Optional loop dependencies the engine composes per run. */
export type AgentLoopExtras = Pick<
  LoopDeps,
  "vision" | "seedTargets" | "plannerContext" | "navigateFirst" | "config"
>;

export async function runAgent(
  rt: EngineRuntime,
  opts: AgentRunOptions,
): Promise<{ ok: true; value: RunReport } | { ok: false; error: string }> {
  const events: RunEvent[] = [];
  const callerHooks = opts.hooks ?? {};
  const hooks: RunHooks = {
    ...callerHooks,
    onEvent: (e) => {
      events.push(e);
      callerHooks.onEvent?.(e);
    },
  };
  const session = openSession(rt, hooks);
  if (!session.ok) return session;
  const s = session.value;
  const learning = opts.knowledge?.kb.session(opts.task.startUrl);
  const launched = await opts.launch();
  s.sink.emit({
    type: "run.start",
    task: opts.task,
    ...(gitSha() ? { gitSha: gitSha() } : {}),
    decisionModel: opts.decision.id,
    surface: launched.ok ? launched.value.surface : "none",
  });
  if (!launched.ok) {
    s.sink.emit({
      type: "run.end",
      outcome: "error",
      reason: `launch failed: ${launched.error.message}`,
      steps: 0,
      wallMs: 0,
      costUsd: 0,
      decisionCalls: 0,
      modelCalls: 0,
      modeShares: {},
    });
    const summary = await closeSession(s, undefined);
    return {
      ok: true,
      value: {
        runId: s.recorder.runId,
        folder: s.recorder.paths.folder,
        outcome: "error",
        reason: launched.error.message,
        summary,
        oraclePass: undefined,
        result: {
          outcome: "error",
          reason: launched.error.message,
          steps: 0,
          wallMs: 0,
          costUsd: 0,
          decisionCalls: 0,
          modelCalls: 0,
          modeShares: {},
          timings: [],
        },
      },
    };
  }
  const { computer } = launched.value;
  if (opts.trace !== false) await computer.startRecording(s.recorder.paths.folder);
  const signal = runSignal(opts.task, hooks.signal);
  let result: RunResult;
  try {
    result = await runTask(opts.task, {
      computer,
      decision: opts.decision,
      events: s.sink,
      secrets: rt.secrets,
      config: { gates: rt.config.gates, ...opts.loop?.config },
      ...(opts.loop?.vision ? { vision: opts.loop.vision } : {}),
      ...(opts.loop?.seedTargets ? { seedTargets: opts.loop.seedTargets } : {}),
      ...(opts.loop?.plannerContext ? { plannerContext: opts.loop.plannerContext } : {}),
      ...(opts.loop?.navigateFirst ? { navigateFirst: opts.loop.navigateFirst } : {}),
      ...(opts.knowledge?.recipes ? { recipes: opts.knowledge.kb.book() } : {}),
      ...(learning ? { onSnapshot: learning.onSnapshot } : {}),
      logger: rt.logger.child({ pkg: "core" }),
      ...(hooks.oracle ? { oracle: hooks.oracle } : {}),
      ...(hooks.approve ? { approve: hooks.approve } : {}),
      ...(opts.planner ? { planner: opts.planner } : {}),
      ...(opts.writer ? { writer: opts.writer } : {}),
      signal,
      ...(hooks.control ? { control: hooks.control } : {}),
    });
  } catch (e) {
    const reason = `engine error: ${e instanceof Error ? e.message : String(e)}`;
    s.sink.emit({
      type: "run.end",
      outcome: "error",
      reason,
      steps: 0,
      wallMs: 0,
      costUsd: 0,
      decisionCalls: 0,
      modelCalls: 0,
      modeShares: {},
    });
    result = {
      outcome: "error",
      reason,
      steps: 0,
      wallMs: 0,
      costUsd: 0,
      decisionCalls: 0,
      modelCalls: 0,
      modeShares: {},
      timings: [],
    };
  }
  const oraclePass = hooks.oracle ? await hooks.oracle(opts.task.id, result.answer) : undefined;
  const summary = await closeSession(s, launched.value);
  const knowledge =
    opts.knowledge && learning
      ? afterRun(opts.knowledge, {
          runId: s.recorder.runId,
          task: opts.task,
          events,
          passed: oraclePass ?? result.outcome === "success",
          replay: result.replay,
          session: learning,
        })
      : undefined;
  for (const e of knowledge?.errors ?? []) rt.logger.warn({ pkg: "knowledge" }, e);
  return {
    ok: true,
    value: {
      runId: s.recorder.runId,
      folder: s.recorder.paths.folder,
      outcome: result.outcome,
      reason: result.reason,
      summary,
      oraclePass,
      result,
      ...(knowledge ? { knowledge } : {}),
    },
  };
}

/**
 * Hard wall-clock cap: the task's time budget aborts the run's signal (decision, planner and writer calls
 * stop at once; the loop ends as budget_exhausted), combined with the caller's own signal.
 */
export function runSignal(task: TaskSpec, caller?: AbortSignal): AbortSignal {
  const wall = AbortSignal.timeout(Math.max(1, Math.ceil(task.budget.seconds * 1000)));
  return caller ? AbortSignal.any([caller, wall]) : wall;
}

export interface ReplayRunOptions {
  task: TaskSpec;
  steps: ReplayStep[];
  launch: ComputerLauncher;
  hooks?: RunHooks;
  replayOf: string;
  /** Enables Jev healing of moved targets (one call per healed step). */
  decision?: DecisionProvider;
}

export async function runReplay(
  rt: EngineRuntime,
  opts: ReplayRunOptions,
): Promise<{ ok: true; value: RunReport } | { ok: false; error: string }> {
  const hooks = opts.hooks ?? {};
  const session = openSession(rt, hooks);
  if (!session.ok) return session;
  const s = session.value;
  const launched = await opts.launch();
  s.sink.emit({
    type: "run.start",
    task: opts.task,
    ...(gitSha() ? { gitSha: gitSha() } : {}),
    decisionModel: `replay:${opts.replayOf}`,
    surface: launched.ok ? launched.value.surface : "none",
  });
  if (!launched.ok) {
    s.sink.emit({
      type: "run.end",
      outcome: "error",
      reason: launched.error.message,
      steps: 0,
      wallMs: 0,
      costUsd: 0,
      decisionCalls: 0,
      modelCalls: 0,
      modeShares: {},
    });
    await closeSession(s, undefined);
    return { ok: false, error: launched.error.message };
  }
  await launched.value.computer.startRecording(s.recorder.paths.folder);
  const result = await replayRun(opts.task, opts.steps, {
    computer: launched.value.computer,
    events: s.sink,
    ...(hooks.oracle ? { oracle: hooks.oracle } : {}),
    ...(opts.decision ? { decision: opts.decision } : {}),
  });
  const oraclePass = hooks.oracle ? await hooks.oracle(opts.task.id) : undefined;
  const summary = await closeSession(s, launched.value);
  return {
    ok: true,
    value: {
      runId: s.recorder.runId,
      folder: s.recorder.paths.folder,
      outcome: result.outcome,
      reason: result.reason,
      summary,
      oraclePass,
      result,
    },
  };
}
