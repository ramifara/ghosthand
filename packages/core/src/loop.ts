// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The mode-B step loop (plan §3.3): settle → observe → done_when → one Jev request → gates → act → record.
import type {
  Action,
  ActionResult,
  Answer,
  Computer,
  DecisionProvider,
  EffectClass,
  Element,
  Entry,
  FieldValue,
  GateName,
  Plan,
  Questions,
  RouterMode,
  RunEventDraft,
  RunOutcome,
  Snapshot,
  StepTiming,
  Subgoal,
  TaskSpec,
} from "@ghosthand/protocol";
import { type AnswerResult, extractAnswer } from "./answer.ts";
import { BudgetTracker } from "./budget.ts";
import { buildCandidates, findByToken, type Operation } from "./candidates.ts";
import { evaluateDoneWhen, hasDeterministicPredicates } from "./done-when.ts";
import { type ForbiddenRule, forbiddenRules, matchForbidden } from "./effect-rules.ts";
import { allPassed, choiceConfidence, combineEffect, evaluateGates } from "./gates.ts";
import { buildTextOptions, type TextOption } from "./literals.ts";
import { type Clock, type Logger, noopLogger, systemClock } from "./logger.ts";
import type { Planner } from "./planner.ts";
import {
  AMBIGUOUS,
  BLOCKED,
  buildActQuestions,
  NONE,
  optionQuestions,
  regionQuestion,
  targetHead,
  WAIT,
} from "./questions.ts";
import type { SecretsRegistry } from "./secrets.ts";
import { StallDetector, screenSignature } from "./stall.ts";
import { buildNarrowState, buildState, estimateTokens, type HistoryEntry } from "./state-builder.ts";
import { MAX_HANDOFFS_PER_SUBGOAL, type Writer, type WriterHint } from "./writer.ts";

/** Receives typed events; the recorder implements it. */
export interface EventSink {
  emit(draft: RunEventDraft): void;
  writeScreenshot?(step: number, bytes: Uint8Array): string;
  writeState?(step: number, purpose: string, state: unknown): string;
}

export interface ApprovalRequest {
  step: number;
  action: Action;
  element: Element | undefined;
  effect: EffectClass;
  subgoal: Subgoal;
}

export interface LoopConfig {
  gates: { operation: number; target: number; stuck: number };
  /** Per-step deadline for the decision call, ms. */
  decisionDeadlineMs: number;
  screenshots: boolean;
  /** State size guard (tokens); larger states are narrowed. */
  maxStateTokens: number;
  /** Consecutive gate refusals tolerated before the subgoal is declared stuck. */
  maxConsecutiveRefusals: number;
  settleCapMs: number;
  /** Send the next decision in parallel with a model verify check on the same snapshot. */
  speculate: boolean;
  /** Mode C replans per run (plan: ≤ 2). */
  maxReplans: number;
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  gates: { operation: 0.65, target: 0.7, stuck: 0.85 },
  decisionDeadlineMs: 6000,
  screenshots: true,
  maxStateTokens: 20_000,
  maxConsecutiveRefusals: 3,
  settleCapMs: 5000,
  speculate: true,
  maxReplans: 2,
};

export interface LoopDeps {
  computer: Computer;
  decision: DecisionProvider;
  events: EventSink;
  secrets: SecretsRegistry;
  config?: Partial<LoopConfig>;
  logger?: Logger;
  clock?: Clock;
  oracle?: (taskId: string) => Promise<boolean | undefined>;
  /** Called for "commit" actions not pre-approved by the subgoal. Absent → refused. */
  approve?: (req: ApprovalRequest) => Promise<boolean>;
  signal?: AbortSignal;
  /** Gives a focus hint or free text when Jev is unsure (P1-04). Never picks clicks. */
  writer?: Writer;
  /** Plans when the task has no plan and replans failed subgoals (mode C). */
  planner?: Planner;
  /** Skip opening task.startUrl (the caller already navigated). */
  skipOpen?: boolean;
  /** Pause/resume for human takeover. Checked before every step and right before every act. */
  control?: RunControl;
}

/**
 * Human takeover hook (Phase 2). `checkpoint()` resolves at once while the run is not paused; while it is
 * paused it resolves on resume (or abort). It returns the milliseconds spent paused (0 when it did not wait).
 * After a pause the loop drops the pending decision and re-observes, because the human changed the page.
 */
export interface RunControl {
  checkpoint(): Promise<number>;
}

export interface RunResult {
  outcome: RunOutcome;
  reason: string;
  steps: number;
  wallMs: number;
  costUsd: number;
  decisionCalls: number;
  modelCalls: number;
  modeShares: Record<string, number>;
  timings: StepTiming[];
  /** Reported answer for tasks that ask for one. */
  answer?: string;
  answeredBy?: "decision" | "writer";
}

/** One subgoal per task when no plan is given; the goal itself is checked by the model. */
export function defaultPlan(task: TaskSpec): Plan {
  return {
    source: "task",
    subgoals: [
      {
        id: "main",
        goal: task.instruction,
        doneWhen: { all: [{ kind: "model", criteria: task.instruction }], none: [] },
        allowedEffects: ["advance", "commit"],
        maxSteps: task.budget.steps,
        seedTargets: [],
      },
    ],
  };
}

type StepOutcome =
  | { kind: "continue" }
  | { kind: "subgoal_done" }
  | { kind: "end"; outcome: RunOutcome; reason: string };

export async function runTask(task: TaskSpec, deps: LoopDeps): Promise<RunResult> {
  const cfg: LoopConfig = {
    ...DEFAULT_LOOP_CONFIG,
    ...deps.config,
    gates: { ...DEFAULT_LOOP_CONFIG.gates, ...deps.config?.gates },
  };
  const clock = deps.clock ?? systemClock;
  const log = deps.logger ?? noopLogger;
  const budget = new BudgetTracker(task.budget, clock);
  const forbidden = forbiddenRules(task.forbidden, task.instruction);
  const started = clock.now();
  let plan = task.plan ?? defaultPlan(task);
  let replans = 0;
  const modeCounts: Partial<Record<RouterMode, number>> = {};
  const timings: StepTiming[] = [];
  let decisionCalls = 0;
  let modelCalls = 0;
  let step = 0;

  const emit = (d: RunEventDraft) => deps.events.emit(d);
  /** A human held the run (takeover): credit the time budget and record it. */
  const resumed = (at: number, pausedMs: number) => {
    budget.paused(pausedMs);
    emit({
      type: "human",
      step: at,
      kind: "takeover",
      detail: `resumed after ${Math.round(pausedMs / 100) / 10}s of takeover; re-observing`,
      granted: true,
    });
  };
  const finish = (outcome: RunOutcome, reason: string, answered?: AnswerResult): RunResult => {
    const total = Object.values(modeCounts).reduce((a, b) => a + (b ?? 0), 0);
    const modeShares: Record<string, number> = {};
    for (const [m, n] of Object.entries(modeCounts)) modeShares[m] = total > 0 ? (n ?? 0) / total : 0;
    const result: RunResult = {
      outcome,
      reason,
      steps: step,
      wallMs: clock.now() - started,
      costUsd: budget.usd,
      decisionCalls,
      modelCalls,
      modeShares,
      timings,
      ...(answered ? { answer: answered.answer, answeredBy: answered.by } : {}),
    };
    emit({
      type: "run.end",
      outcome,
      reason,
      steps: step,
      wallMs: result.wallMs,
      costUsd: result.costUsd,
      decisionCalls,
      modelCalls,
      modeShares,
      ...(answered ? { answer: answered.answer, answeredBy: answered.by } : {}),
    });
    log.info({ outcome, reason, steps: step, costUsd: result.costUsd }, "run finished");
    return result;
  };

  const plannerCall = (r: Awaited<ReturnType<Planner["plan"]>>, role: string) => {
    modelCalls++;
    if (r.ok) budget.spend(r.value.costUsd ?? 0);
    emit({
      type: "model.call",
      role,
      model: r.ok ? (r.value.model ?? r.value.planner) : (deps.planner?.id ?? "planner"),
      latencyMs: r.ok ? r.value.latencyMs : 0,
      ...(r.ok && r.value.costUsd !== undefined ? { costUsd: r.value.costUsd } : {}),
      ok: r.ok,
      summary: r.ok ? `${r.value.plan.subgoals.length} subgoals` : `${r.error.kind}: ${r.error.message}`,
    });
  };

  if (!deps.skipOpen) {
    const opened = await deps.computer.open(task.startUrl);
    if (!opened.ok) return finish("error", `open failed: ${opened.error.kind}: ${opened.error.message}`);
  }

  // Mode C: without a task plan, the planner plans once from the first screen.
  if (!task.plan && deps.planner) {
    const first = await deps.computer.observe();
    const r = await deps.planner.plan(
      {
        goal: task.instruction,
        startUrl: task.startUrl,
        ...(first.ok ? { pageSummary: pageSummary(first.value, deps.secrets) } : {}),
        maxSubgoals: 12,
      },
      deps.signal ? { signal: deps.signal } : {},
    );
    plannerCall(r, "planner");
    if (r.ok) {
      plan = r.value.plan;
      modeCounts.C = 0;
    }
  }
  emit({ type: "plan", plan });

  /** Replaces the failed subgoal and the rest of the plan. Returns true when the run should continue. */
  const replan = async (
    index: number,
    failed: Subgoal,
    reason: string,
    history: HistoryEntry[],
  ): Promise<boolean> => {
    if (!deps.planner || replans >= cfg.maxReplans || budget.exceeded()) return false;
    replans++;
    emit({ type: "escalate", step, from: "B", to: "C", reason: `replan ${replans}: ${reason}` });
    const now = await deps.computer.observe();
    const r = await deps.planner.replan(
      {
        goal: task.instruction,
        startUrl: task.startUrl,
        ...(now.ok ? { pageSummary: pageSummary(now.value, deps.secrets) } : {}),
        maxSubgoals: 12,
        plan,
        failedSubgoalId: failed.id,
        failureReason: reason,
        history: history.slice(-8).map((h) => `${h.step}. ${h.text}`),
      },
      deps.signal ? { signal: deps.signal } : {},
    );
    plannerCall(r, "planner");
    if (!r.ok) return false;
    plan = { source: "planner", subgoals: [...plan.subgoals.slice(0, index), ...r.value.plan.subgoals] };
    emit({ type: "plan", plan });
    modeCounts.C = (modeCounts.C ?? 0) + 1;
    return true;
  };

  subgoals: for (let i = 0; i < plan.subgoals.length; i++) {
    const subgoal = plan.subgoals[i];
    if (!subgoal) break;
    emit({ type: "subgoal.start", subgoalId: subgoal.id, goal: subgoal.goal });
    const stall = new StallDetector();
    const history: HistoryEntry[] = [];
    const triedNoEffect = new Set<string>();
    let subgoalSteps = 0;
    let refusals = 0;
    let lastGoalDone = 0;
    const handoffs = { count: 0 };
    const extraTexts: string[] = [];

    while (true) {
      if (deps.control) {
        const pausedMs = await deps.control.checkpoint();
        if (pausedMs > 0) resumed(step, pausedMs);
      }
      if (deps.signal?.aborted) return finish(...abortOutcome(deps.signal));
      const over = budget.exceeded();
      if (over) {
        emit({ type: "subgoal.end", subgoalId: subgoal.id, state: "unknown", steps: subgoalSteps });
        return finish("budget_exhausted", `budget exceeded: ${over.detail}`);
      }
      if (subgoalSteps >= subgoal.maxSteps) {
        emit({ type: "subgoal.end", subgoalId: subgoal.id, state: "unknown", steps: subgoalSteps });
        const reason = `subgoal ${subgoal.id} exceeded ${subgoal.maxSteps} steps`;
        if (await replan(i, subgoal, reason, history)) {
          i--;
          continue subgoals;
        }
        return finish("budget_exhausted", reason);
      }

      const current = step + 1;
      const timing: StepTiming = { settleMs: 0, observeMs: 0, decideMs: 0, actMs: 0, verifyMs: 0 };

      // settle
      let t = clock.now();
      await deps.computer.waitIdle({ capMs: cfg.settleCapMs });
      timing.settleMs = clock.now() - t;

      // observe
      t = clock.now();
      const observed = await deps.computer.observe();
      if (!observed.ok)
        return finish("error", `observe failed: ${observed.error.kind}: ${observed.error.message}`);
      const snapshot = observed.value;
      let screenshot: string | undefined;
      if (cfg.screenshots && deps.events.writeScreenshot) {
        const shot = await deps.computer.screenshot();
        if (shot.ok) screenshot = deps.events.writeScreenshot(current, shot.value.data);
      }
      timing.observeMs = clock.now() - t;
      emit({
        type: "observe",
        step: current,
        snapshotId: snapshot.id,
        ...(snapshot.url ? { url: snapshot.url } : {}),
        elementCount: snapshot.elements.length,
        tokenEstimate: snapshot.tokenEstimate,
        ...(screenshot ? { screenshot } : {}),
      });
      stall.observe(screenSignature(snapshot));
      // P1-06: a page too large for one request is narrowed to a region before the act decision.
      const oversized = needsNarrowing(snapshot, task, subgoal, current, history, cfg, deps);

      // done_when (deterministic and oracle every step; model predicates only when the goal looks done)
      t = clock.now();
      // With deterministic predicates, model predicates only run once those pass (early exit inside).
      const checkModel = hasDeterministicPredicates(subgoal.doneWhen) || lastGoalDone >= 0.5;
      const verifyState = buildState(
        {
          instruction: task.instruction,
          goal: subgoal.goal,
          step: current,
          phase: "verify",
          snapshot,
          history,
          inputs: task.secrets,
        },
        deps.secrets,
      );
      const ctx: DecideContext = {
        deps,
        cfg,
        task,
        subgoal,
        snapshot,
        step: current,
        history,
        triedNoEffect,
        forbidden,
        stall,
        timing,
        clock,
        log,
        onDecision: (costUsd) => {
          decisionCalls++;
          budget.spend(costUsd);
        },
        onGoalDone: (p) => {
          lastGoalDone = p;
        },
        onModelCall: (costUsd) => {
          modelCalls++;
          budget.spend(costUsd);
        },
        onResumed: (pausedMs) => resumed(current, pausedMs),
        handoffs,
        extraTexts,
      };
      // Speculation (plan §3.4): when a model check runs, send this step's decision in parallel on the
      // same snapshot. If the check says done, the answer is discarded (only its cost is paid).
      const speculative =
        cfg.speculate && !oversized && checkModel && subgoal.doneWhen.all.some((p) => p.kind === "model")
          ? startAct(ctx)
          : undefined;
      const done = await evaluateDoneWhen(
        checkModel ? subgoal.doneWhen : { all: [], none: subgoal.doneWhen.none },
        snapshot,
        {
          decision: deps.decision,
          state: verifyState,
          ...(deps.oracle ? { oracle: deps.oracle } : {}),
          ...(deps.signal ? { signal: deps.signal } : {}),
        },
      );
      decisionCalls += done.decisionCalls;
      budget.spend(done.costUsd);
      timing.verifyMs = clock.now() - t;
      if (done.decidedBy !== "none") {
        emit({
          type: "verify",
          step: current,
          state: done.state,
          decidedBy: done.decidedBy,
          predicates: done.predicates.map(({ predicate, state }) => ({ predicate, state })),
        });
      }
      if (done.state === "satisfied") {
        if (speculative) {
          await speculative.response;
          log.debug({ step: current }, "speculative decision discarded: subgoal done");
        }
        emit({ type: "subgoal.end", subgoalId: subgoal.id, state: "satisfied", steps: subgoalSteps });
        break;
      }

      step = current;
      subgoalSteps++;
      budget.step();

      const verdict = stall.verdict();
      if (verdict.stalled) {
        if (speculative) await speculative.response;
        emit({ type: "escalate", step, from: "B", to: "H", reason: verdict.reason ?? "stalled" });
        emit({ type: "subgoal.end", subgoalId: subgoal.id, state: "unsatisfied", steps: subgoalSteps });
        if (await replan(i, subgoal, verdict.reason ?? "stalled", history)) {
          i--;
          continue subgoals;
        }
        return finish("stuck", verdict.reason ?? "stalled");
      }

      if (oversized) {
        t = clock.now();
        const scoped = await narrow(ctx);
        timing.observeMs += clock.now() - t;
        if (scoped) ctx.snapshot = scoped;
      }
      const outcome = await decideAndAct(ctx, speculative);
      modeCounts.B = (modeCounts.B ?? 0) + 1;
      timings.push(timing);
      emit({ type: "step.end", step, timing, mode: "B" });

      if (outcome.kind === "end") {
        emit({ type: "subgoal.end", subgoalId: subgoal.id, state: "unsatisfied", steps: subgoalSteps });
        if (outcome.outcome === "stuck" && (await replan(i, subgoal, outcome.reason, history))) {
          i--;
          continue subgoals;
        }
        return finish(outcome.outcome, outcome.reason);
      }
      if (outcome.kind === "continue" && "refused" in outcome) refusals++;
      else refusals = 0;
      if (refusals >= cfg.maxConsecutiveRefusals) {
        emit({ type: "escalate", step, from: "B", to: "H", reason: `${refusals} consecutive refusals` });
        emit({ type: "subgoal.end", subgoalId: subgoal.id, state: "unsatisfied", steps: subgoalSteps });
        const reason = `${refusals} consecutive steps refused by gates`;
        if (await replan(i, subgoal, reason, history)) {
          i--;
          continue subgoals;
        }
        return finish("stuck", reason);
      }
    }
  }

  if (task.expectsAnswer) {
    const final = await deps.computer.observe();
    const answered = final.ok
      ? await extractAnswer(task.instruction, final.value, {
          decision: deps.decision,
          secrets: deps.secrets,
          ...(deps.writer ? { writer: deps.writer } : {}),
          ...(deps.signal ? { signal: deps.signal } : {}),
        })
      : undefined;
    if (answered) {
      decisionCalls += answered.decisionCalls;
      modelCalls += answered.modelCalls;
      budget.spend(answered.costUsd);
      return finish("success", "every subgoal's done_when is satisfied; answer reported", answered);
    }
    return finish("failure", "done_when satisfied but no answer could be read from the page");
  }
  return finish("success", "every subgoal's done_when is satisfied");
}

interface DecideContext {
  deps: LoopDeps;
  cfg: LoopConfig;
  task: TaskSpec;
  subgoal: Subgoal;
  snapshot: Snapshot;
  step: number;
  history: HistoryEntry[];
  triedNoEffect: Set<string>;
  /** Forbidden phrases the code enforces (see effect-rules). */
  forbidden: ForbiddenRule[];
  stall: StallDetector;
  timing: StepTiming;
  clock: Clock;
  log: Logger;
  onDecision: (costUsd: number) => void;
  onGoalDone: (p: number) => void;
  onModelCall: (costUsd: number) => void;
  /** The run was paused for takeover right before acting. */
  onResumed: (pausedMs: number) => void;
  /** Writer hand-offs on this subgoal since the last confirmed action. */
  handoffs: { count: number };
  /** Free text the writer supplied; offered to Jev as extra literals. */
  extraTexts: string[];
  /** Writer hint for this re-ask only. */
  hint?: string;
}

/** Literal source for the text head: goal, instruction and writer-supplied texts. */
const textGoal = (ctx: DecideContext): string =>
  [ctx.subgoal.goal, ctx.task.instruction, ...ctx.extraTexts.map((t) => JSON.stringify(t))].join("\n");

type DecideOutcome = StepOutcome | { kind: "continue"; refused: true };

async function ask(
  ctx: DecideContext,
  purpose: "act" | "narrow",
  state: Entry,
  questions: Parameters<DecisionProvider["ask"]>[1],
) {
  const { deps, step, cfg } = ctx;
  const stateFile = deps.events.writeState?.(ctx.step, purpose, state);
  deps.events.emit({
    type: "decision.request",
    step,
    purpose,
    questions,
    ...(stateFile ? { stateFile } : {}),
    stateTokens: estimateTokens(state),
  });
  const deadline = AbortSignal.timeout(cfg.decisionDeadlineMs);
  const signal = deps.signal ? AbortSignal.any([deps.signal, deadline]) : deadline;
  const r = await deps.decision.ask(state, questions, { signal });
  if (r.ok) {
    ctx.onDecision(r.value.costUsd);
    deps.events.emit({
      type: "decision.answer",
      step,
      answers: r.value.answers,
      model: r.value.model,
      ...(r.value.requestId ? { requestId: r.value.requestId } : {}),
      latencyMs: r.value.latencyMs,
      costUsd: r.value.costUsd,
      inputTokens: r.value.usage.inputTokens,
    });
  } else {
    ctx.onDecision(0);
    deps.events.emit({
      type: "decision.answer",
      step,
      error: r.error,
      model: deps.decision.id,
      ...(r.error.requestId ? { requestId: r.error.requestId } : {}),
      latencyMs: 0,
      costUsd: 0,
      inputTokens: 0,
    });
  }
  return r;
}

const refuse = (): DecideOutcome => ({ kind: "continue", refused: true });

interface PreparedAct {
  questions: Questions;
  offered: Operation[];
  state: Entry;
}

function prepareAct(ctx: DecideContext): PreparedAct {
  const { deps, cfg, task, subgoal, snapshot, step, history } = ctx;
  const triedHere = new Set(
    [...ctx.triedNoEffect].filter((k) => ctx.stall.triedHere(k)).map((k) => k.split("|")[1] ?? ""),
  );
  const candidates = buildCandidates(snapshot, { seedTargets: subgoal.seedTargets, triedHere });
  const textOptions = buildTextOptions(textGoal(ctx), task.secrets, deps.secrets);
  const { questions, offered } = buildActQuestions({ candidates, textOptions, forbidden: task.forbidden });

  // Elements shown in state: everything offered in any head (deduplicated), plus non-actionable context.
  const offeredTokens = new Set(offered.flatMap((op) => candidates[op].map((e) => e.token)));
  let elements = snapshot.elements.filter(
    (e) => offeredTokens.has(e.token) || e.roleClass === "heading" || e.roleClass === "text",
  );
  let state = buildState(
    {
      instruction: task.instruction,
      goal: subgoal.goal,
      step,
      phase: "act",
      snapshot,
      elements,
      history,
      inputs: task.secrets,
      ...(ctx.hint ? { hint: ctx.hint } : {}),
    },
    deps.secrets,
  );
  // Size guard: narrow to the highest-ranked elements (real region narrowing lands in P1-06).
  while (estimateTokens(state) > cfg.maxStateTokens && elements.length > 20) {
    elements = elements.slice(0, Math.floor(elements.length * 0.7));
    state = buildState(
      {
        instruction: task.instruction,
        goal: subgoal.goal,
        step,
        phase: "act",
        snapshot,
        elements,
        history,
        inputs: task.secrets,
        ...(ctx.hint ? { hint: ctx.hint } : {}),
      },
      deps.secrets,
    );
  }
  return { questions, offered, state };
}

type AskResult = Awaited<ReturnType<typeof ask>>;

/** A decision request sent early (speculatively) for this step's snapshot. */
export interface SpeculativeAct {
  prepared: PreparedAct;
  response: Promise<AskResult>;
  startedAt: number;
}

function startAct(ctx: DecideContext): SpeculativeAct {
  const prepared = prepareAct(ctx);
  return {
    prepared,
    response: ask(ctx, "act", prepared.state, prepared.questions),
    startedAt: ctx.clock.now(),
  };
}

async function decideAndAct(ctx: DecideContext, speculative?: SpeculativeAct): Promise<DecideOutcome> {
  const { deps, cfg, subgoal, snapshot, step, history, clock } = ctx;
  let t = clock.now();
  const pending = speculative ?? startAct(ctx);
  const { offered } = pending.prepared;
  const r = await pending.response;
  ctx.timing.decideMs = clock.now() - t;
  if (deps.signal?.aborted) {
    const [outcome, reason] = abortOutcome(deps.signal);
    return { kind: "end", outcome, reason };
  }
  if (!r.ok) {
    if (r.error.kind === "auth" || r.error.kind === "budget")
      return { kind: "end", outcome: "error", reason: `decision ${r.error.kind}: ${r.error.message}` };
    return refuse();
  }
  const answers = r.value.answers;
  const goalDone = noulP(answers.goal_done);
  ctx.onGoalDone(goalDone);
  const stuckP = noulP(answers.stuck);
  if (stuckP >= cfg.gates.stuck) {
    deps.events.emit({ type: "escalate", step, from: "B", to: "H", reason: `stuck p=${stuckP.toFixed(2)}` });
    return { kind: "end", outcome: "stuck", reason: `decision model reports stuck (p=${stuckP.toFixed(2)})` };
  }

  const opAnswer = answers.operation;
  const op = opAnswer?.type === "choice" ? opAnswer.choice : undefined;
  if (op === WAIT) {
    history.push({ step, text: "waited for the page" });
    await deps.computer.waitIdle({ capMs: cfg.settleCapMs });
    return { kind: "continue" };
  }
  if (op === BLOCKED || op === undefined || !offered.includes(op as Operation)) {
    history.push({ step, text: `no action (${op ?? "abstain"})` });
    gate(ctx, "operation_confidence", false, `operation ${op ?? "abstain"}`);
    return (await handOff(ctx, `the agent chose ${op ?? "no valid operation"}`)) ?? refuse();
  }
  const operation = op as Operation;
  const targetAnswer = answers[targetHead(operation)];
  const targetToken = targetAnswer?.type === "choice" ? targetAnswer.choice : undefined;
  const element =
    targetToken && targetToken !== NONE && targetToken !== AMBIGUOUS
      ? findByToken(snapshot, targetToken)
      : undefined;
  const effectAnswer = answers.effect;
  const modelEffect = effectAnswer?.type === "choice" ? (effectAnswer.choice as EffectClass) : undefined;
  // Code check: a target whose name (and row/card context) matches a forbidden phrase is never acted on.
  const forbiddenHit = element ? matchForbidden(element, ctx.forbidden) : undefined;
  const effect: EffectClass = forbiddenHit ? "forbidden" : combineEffect(element, modelEffect);

  // Build the action.
  let action: Action | undefined;
  let describe = "";
  if (element) {
    switch (operation) {
      case "press":
        action = { type: "press", token: element.token };
        describe = `press ${element.role} "${element.name}"`;
        break;
      case "toggle":
        action = { type: "toggle", token: element.token };
        describe = `toggle ${element.role} "${element.name}"`;
        break;
      case "set_value": {
        const text = pickText(answers.text, ctx);
        if (text) {
          action = { type: "set_value", token: element.token, value: text.value };
          describe = `set_value "${element.name}" ← ${text.label}`;
        }
        break;
      }
      case "select_option": {
        const option = await pickOption(ctx, element);
        if (option) {
          action = { type: "select_option", token: element.token, option };
          describe = `select "${option}" in "${element.name}"`;
        }
        break;
      }
    }
  }

  const gates = evaluateGates({
    thresholds: cfg.gates,
    operation: opAnswer,
    target: targetAnswer,
    element,
    effect,
    allowedEffects: subgoal.allowedEffects,
    snapshotFresh: true,
  });
  // A commit outside allowedEffects can still be approved by a human.
  const effectGate = gates.find((g) => g.gate === "effect_allowed");
  if (effectGate && forbiddenHit) effectGate.detail = `matches forbidden "${forbiddenHit}"`;
  if (effectGate && !effectGate.passed && effect === "commit" && action && deps.approve) {
    const granted = await deps.approve({ step, action, element, effect, subgoal });
    deps.events.emit({ type: "human", step, kind: "approval", detail: describe, granted });
    if (granted) effectGate.passed = true;
  }
  if (!action)
    gates.push({
      gate: "target_named",
      passed: false,
      detail: operation === "set_value" ? "no text option chosen" : "no option chosen",
    });
  for (const g of gates) gate(ctx, g.gate, g.passed, g.detail);
  if (!allPassed(gates) || !action || !element) {
    const failed = gates.filter((g) => !g.passed);
    // Uncertainty (not policy) failures go to the writer; effect and freshness refusals never do.
    const unsure = failed.length > 0 && failed.every((g) => UNSURE_GATES.has(g.gate));
    const needsText = operation === "set_value" && element !== undefined && !action;
    history.push({
      step,
      text: `refused ${operation} (${gates
        .filter((g) => !g.passed)
        .map((g) => g.gate)
        .join(", ")})`,
    });
    if (unsure) {
      const reason = failed.map((g) => `${g.gate} ${g.detail ?? ""}`.trim()).join("; ");
      const handed = await handOff(ctx, reason, needsText ? element?.name : undefined);
      if (handed) return handed;
    }
    return refuse();
  }

  // Never retry a mutation: the same commit on the same screen is refused.
  const key = `${action.type}|${element.stableId}|${"value" in action ? JSON.stringify(action.value) : ""}`;
  const before = ctx.stall.attempt(key);
  if (before > 0 && effect === "commit") {
    gate(ctx, "repeat", false, "commit already attempted on this screen");
    history.push({ step, text: `refused repeat of ${describe}` });
    return refuse();
  }
  // Takeover: a human may have changed the page while we decided. Drop this decision and re-observe.
  if (deps.control) {
    const pausedMs = await deps.control.checkpoint();
    if (pausedMs > 0) {
      ctx.onResumed(pausedMs);
      history.push({ step, text: `paused before ${describe}; the user took over` });
      return { kind: "continue" };
    }
  }
  const bounds = element.visibleBounds ?? element.bounds;
  deps.events.emit({
    type: "action",
    step,
    action,
    target: {
      stableId: element.stableId,
      role: element.role,
      name: element.name,
      ...(element.automationId ? { automationId: element.automationId } : {}),
      ...(bounds ? { bounds } : {}),
      ...(targetAnswer?.type === "choice" ? { confidence: choiceConfidence(targetAnswer) } : {}),
    },
    mode: "B",
  });
  t = clock.now();
  const result = await execute(deps.computer, action);
  ctx.timing.actMs = clock.now() - t;
  deps.events.emit({ type: "effect", step, result });
  if (result.effect === "suspected_noop" || result.effect === "refused") ctx.triedNoEffect.add(key);
  if (result.effect === "confirmed") ctx.handoffs.count = 0;
  history.push({
    step,
    text: `${describe} (${result.effect}${result.error ? `: ${result.error.kind}` : ""})`,
  });
  return { kind: "continue" };
}

const UNSURE_GATES = new Set<GateName>(["operation_confidence", "target_confidence", "target_named"]);

/**
 * Asks the writer for one hint and re-asks Jev once with it. Returns undefined when no hand-off happens
 * (no writer, already a re-ask, or the writer has nothing). After MAX_HANDOFFS_PER_SUBGOAL hand-offs without a
 * confirmed action the subgoal needs a replan (mode C).
 */
async function handOff(
  ctx: DecideContext,
  reason: string,
  field?: string,
): Promise<DecideOutcome | undefined> {
  const writer = ctx.deps.writer;
  if (!writer || ctx.hint !== undefined) return undefined;
  if (ctx.handoffs.count >= MAX_HANDOFFS_PER_SUBGOAL) {
    ctx.deps.events.emit({
      type: "escalate",
      step: ctx.step,
      from: "B",
      to: "C",
      reason: "two writer hand-offs without progress",
    });
    return {
      kind: "end",
      outcome: "stuck",
      reason: `needs replan: ${MAX_HANDOFFS_PER_SUBGOAL} writer hand-offs without progress`,
    };
  }
  ctx.handoffs.count++;
  const state = buildState(
    {
      instruction: ctx.task.instruction,
      goal: ctx.subgoal.goal,
      step: ctx.step,
      phase: "act",
      snapshot: ctx.snapshot,
      history: ctx.history,
      inputs: ctx.task.secrets,
    },
    ctx.deps.secrets,
  );
  const page = JSON.stringify({ page: state.page, texts: state.texts, elements: state.elements }).slice(
    0,
    8000,
  );
  const t = ctx.clock.now();
  const r = await writer.hint(
    {
      instruction: ctx.task.instruction,
      goal: ctx.subgoal.goal,
      page,
      history: ctx.history.map((h) => `${h.step}. ${h.text}`),
      reason,
      ...(field ? { field } : {}),
    },
    ctx.deps.signal ? { signal: ctx.deps.signal } : {},
  );
  const latencyMs = r.ok ? r.value.latencyMs : ctx.clock.now() - t;
  ctx.onModelCall(r.ok ? r.value.costUsd : 0);
  ctx.deps.events.emit({
    type: "model.call",
    step: ctx.step,
    role: "writer",
    model: r.ok ? r.value.model : writer.id,
    latencyMs,
    ...(r.ok ? { costUsd: r.value.costUsd } : {}),
    ok: r.ok,
    summary: r.ok
      ? ctx.deps.secrets.redact(summarizeHint(r.value.hint))
      : `${r.error.kind}: ${r.error.message}`,
  });
  if (!r.ok || r.value.hint.kind === "none") return undefined;
  const hint = r.value.hint;
  // Free text never carries a secret value: the registry redacts it, and secrets are offered by name anyway.
  const text = hint.kind === "text" ? ctx.deps.secrets.redact(hint.text) : undefined;
  if (text !== undefined && !text.includes("[input:")) ctx.extraTexts.push(text);
  const focus =
    hint.kind === "focus"
      ? hint.focus
      : `Type ${JSON.stringify(text ?? "")} into ${field ? JSON.stringify(field) : "the field"}.`;
  ctx.history.push({ step: ctx.step, text: `writer hint: ${focus.slice(0, 160)}` });
  return decideAndAct({ ...ctx, hint: ctx.deps.secrets.redact(focus) });
}

const summarizeHint = (h: WriterHint): string =>
  h.kind === "focus"
    ? `focus: ${h.focus}`
    : h.kind === "text"
      ? `text (${h.text.length} chars)`
      : `none: ${h.reason}`;

function gate(ctx: DecideContext, name: GateName, passed: boolean, detail?: string): void {
  ctx.deps.events.emit({ type: "gate", step: ctx.step, gate: name, passed, ...(detail ? { detail } : {}) });
}

const noulP = (a: Answer | undefined): number => (a?.type === "noul" ? a.p : 0);

function pickText(
  answer: Answer | undefined,
  ctx: DecideContext,
): { value: FieldValue; label: string } | undefined {
  if (answer?.type !== "choice" || answer.choice === NONE) return undefined;
  if (choiceConfidence(answer) < ctx.cfg.gates.target) return undefined;
  const options: TextOption[] = buildTextOptions(textGoal(ctx), ctx.task.secrets, ctx.deps.secrets);
  const o = options.find((x) => x.key === answer.choice);
  if (!o) return undefined;
  return o.kind === "literal"
    ? { value: o.text, label: o.key }
    : { value: { secretRef: o.name }, label: `[input:${o.name}]` };
}

async function pickOption(ctx: DecideContext, element: Element): Promise<string | undefined> {
  const options = element.options ?? [];
  if (options.length === 0) return undefined;
  // Exact literal match from the goal avoids a call.
  const goal = `${ctx.subgoal.goal}\n${ctx.task.instruction}`.toLowerCase();
  const exact = options.filter((o) => o.trim().length > 1 && goal.includes(o.toLowerCase()));
  if (exact.length === 1) return exact[0];
  const questions = optionQuestions(element, ctx.subgoal.goal);
  const state = buildState(
    {
      instruction: ctx.task.instruction,
      goal: ctx.subgoal.goal,
      step: ctx.step,
      phase: "act",
      snapshot: ctx.snapshot,
      elements: [element],
      history: ctx.history,
      inputs: ctx.task.secrets,
    },
    ctx.deps.secrets,
  );
  // Every partition goes in one request; exactly one may name an option.
  const r = await ask(ctx, "act", state, questions);
  if (!r.ok) return undefined;
  return pickedOption(r.value.answers, options, ctx.cfg.gates.target);
}

/**
 * The option chosen across partitions: exactly one partition must name an option with enough confidence;
 * an `ambiguous` partition, a second pick or an abstention means no option.
 */
export function pickedOption(
  answers: Record<string, Answer>,
  options: readonly string[],
  threshold: number,
): string | undefined {
  const parts = Object.entries(answers).filter(([name]) => name.startsWith("option_"));
  if (parts.length === 0) return undefined;
  const picks: Extract<Answer, { type: "choice" }>[] = [];
  for (const [, a] of parts) {
    if (a.type !== "choice" || a.choice === AMBIGUOUS) return undefined;
    if (a.choice !== NONE) picks.push(a);
  }
  const pick = picks[0];
  if (picks.length !== 1 || !pick || choiceConfidence(pick) < threshold) return undefined;
  return options[Number(pick.choice.slice(1))];
}

/** Outcome for an aborted signal: the engine's wall-clock budget ends the run as budget_exhausted. */
function abortOutcome(signal: AbortSignal): [RunOutcome, string] {
  const reason: unknown = signal.reason;
  return reason instanceof Error && reason.name === "TimeoutError"
    ? ["budget_exhausted", "wall-clock budget exceeded (hard abort)"]
    : ["aborted", "aborted by caller"];
}

/** True when the page needs a region choice: no scope yet, at least two regions, and too many tokens. */
function needsNarrowing(
  snapshot: Snapshot,
  task: TaskSpec,
  subgoal: Subgoal,
  step: number,
  history: HistoryEntry[],
  cfg: LoopConfig,
  deps: LoopDeps,
): boolean {
  if (snapshot.scope !== undefined || (snapshot.regions?.length ?? 0) < 2) return false;
  if ((snapshot.pageTokenEstimate ?? 0) > cfg.maxStateTokens) return true;
  const full = buildState(
    {
      instruction: task.instruction,
      goal: subgoal.goal,
      step,
      phase: "act",
      snapshot,
      history,
      inputs: task.secrets,
    },
    deps.secrets,
  );
  return estimateTokens(full) > cfg.maxStateTokens;
}

/**
 * Region narrowing (P1-06): an open dialog is taken without asking; otherwise one Jev request picks a
 * region, and the page is observed again inside it. Returns undefined to keep the full snapshot (then the
 * act state is truncated as the last fallback).
 */
async function narrow(ctx: DecideContext): Promise<Snapshot | undefined> {
  const { deps, snapshot } = ctx;
  const regions = snapshot.regions ?? [];
  let chosen = regions.find((r) => r.kind === "dialog")?.id;
  if (chosen === undefined) {
    const state = buildNarrowState(
      {
        instruction: ctx.task.instruction,
        goal: ctx.subgoal.goal,
        step: ctx.step,
        snapshot,
        history: ctx.history,
        inputs: ctx.task.secrets,
        ...(ctx.hint ? { hint: ctx.hint } : {}),
      },
      deps.secrets,
    );
    const r = await ask(ctx, "narrow", state, { region: regionQuestion(regions) });
    const a = r.ok ? r.value.answers.region : undefined;
    if (a?.type !== "choice" || a.choice === NONE || choiceConfidence(a) < ctx.cfg.gates.operation) {
      ctx.log.debug({ step: ctx.step }, "no region chosen; the act state will be truncated");
      return undefined;
    }
    chosen = a.choice;
  }
  const scoped = await deps.computer.observe({ region: chosen });
  if (!scoped.ok || scoped.value.elements.length === 0) {
    ctx.log.warn({ step: ctx.step, region: chosen }, "region observation failed; keeping the full page");
    return undefined;
  }
  const s = scoped.value;
  deps.events.emit({
    type: "observe",
    step: ctx.step,
    snapshotId: s.id,
    ...(s.url ? { url: s.url } : {}),
    elementCount: s.elements.length,
    tokenEstimate: s.tokenEstimate,
  });
  return s;
}

export function execute(computer: Computer, action: Action): Promise<ActionResult> {
  switch (action.type) {
    case "press":
      return computer.press(action.token);
    case "set_value":
      return computer.setValue(action.token, action.value);
    case "toggle":
      return computer.toggle(action.token, action.checked);
    case "select_option":
      return computer.selectOption(action.token, action.option);
    case "focus":
      return computer.focus(action.token);
    case "scroll_into_view":
      return computer.scrollIntoView(action.token);
    case "click":
      return computer.click(action.target, {
        ...(action.button ? { button: action.button } : {}),
        ...(action.count ? { count: action.count } : {}),
      });
    case "move":
      return computer.move(action.target);
    case "drag":
      return computer.drag(action.from, action.to);
    case "scroll":
      return computer.scroll(action.dx, action.dy, action.target);
    case "type_text":
      return computer.typeText(action.text);
    case "key":
      return computer.key(action.keys);
    default:
      return Promise.resolve({
        effect: "refused",
        route: "none",
        evidence: [],
        error: { kind: "unsupported", message: `action ${action.type} is not executed by the loop` },
        invalidatedSnapshots: [],
        durationMs: 0,
      });
  }
}

/** Plain-text first-screen summary for the planner (redacted). */
export function pageSummary(snapshot: Snapshot, secrets: SecretsRegistry): string {
  const lines = [
    `Title: ${snapshot.title}`,
    ...(snapshot.url ? [`URL: ${snapshot.url}`] : []),
    `Text: ${snapshot.text.slice(0, 1500)}`,
    "Elements:",
    ...snapshot.elements
      .slice(0, 60)
      .map((e) => `- ${e.role} "${e.name}"${e.context ? ` (${e.context.slice(0, 60)})` : ""}`),
  ];
  return secrets.redact(lines.join("\n"));
}
