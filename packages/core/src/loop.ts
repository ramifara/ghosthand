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
  RouterMode,
  RunEventDraft,
  RunOutcome,
  Snapshot,
  StepTiming,
  Subgoal,
  TaskSpec,
} from "@ghosthand/protocol";
import { BudgetTracker } from "./budget.ts";
import { buildCandidates, findByToken, type Operation } from "./candidates.ts";
import { evaluateDoneWhen, hasDeterministicPredicates } from "./done-when.ts";
import { allPassed, choiceConfidence, combineEffect, evaluateGates } from "./gates.ts";
import { buildTextOptions, type TextOption } from "./literals.ts";
import { type Clock, type Logger, noopLogger, systemClock } from "./logger.ts";
import {
  AMBIGUOUS,
  BLOCKED,
  buildActQuestions,
  NONE,
  optionQuestions,
  targetHead,
  WAIT,
} from "./questions.ts";
import type { SecretsRegistry } from "./secrets.ts";
import { StallDetector, screenSignature } from "./stall.ts";
import { buildState, estimateTokens, type HistoryEntry } from "./state-builder.ts";

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
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  gates: { operation: 0.65, target: 0.7, stuck: 0.85 },
  decisionDeadlineMs: 6000,
  screenshots: true,
  maxStateTokens: 20_000,
  maxConsecutiveRefusals: 3,
  settleCapMs: 5000,
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
  /** Skip opening task.startUrl (the caller already navigated). */
  skipOpen?: boolean;
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
  const started = clock.now();
  const plan = task.plan ?? defaultPlan(task);
  const modeCounts: Partial<Record<RouterMode, number>> = {};
  const timings: StepTiming[] = [];
  let decisionCalls = 0;
  const modelCalls = 0;
  let step = 0;

  const emit = (d: RunEventDraft) => deps.events.emit(d);
  const finish = (outcome: RunOutcome, reason: string): RunResult => {
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
    });
    log.info({ outcome, reason, steps: step, costUsd: result.costUsd }, "run finished");
    return result;
  };

  emit({ type: "plan", plan });

  if (!deps.skipOpen) {
    const opened = await deps.computer.open(task.startUrl);
    if (!opened.ok) return finish("error", `open failed: ${opened.error.kind}: ${opened.error.message}`);
  }

  for (const subgoal of plan.subgoals) {
    emit({ type: "subgoal.start", subgoalId: subgoal.id, goal: subgoal.goal });
    const stall = new StallDetector();
    const history: HistoryEntry[] = [];
    const triedNoEffect = new Set<string>();
    let subgoalSteps = 0;
    let refusals = 0;
    let lastGoalDone = 0;

    while (true) {
      if (deps.signal?.aborted) return finish("aborted", "aborted by caller");
      const over = budget.exceeded();
      if (over) {
        emit({ type: "subgoal.end", subgoalId: subgoal.id, state: "unknown", steps: subgoalSteps });
        return finish("budget_exhausted", `budget exceeded: ${over.detail}`);
      }
      if (subgoalSteps >= subgoal.maxSteps) {
        emit({ type: "subgoal.end", subgoalId: subgoal.id, state: "unknown", steps: subgoalSteps });
        return finish("budget_exhausted", `subgoal ${subgoal.id} exceeded ${subgoal.maxSteps} steps`);
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
        emit({ type: "subgoal.end", subgoalId: subgoal.id, state: "satisfied", steps: subgoalSteps });
        break;
      }

      step = current;
      subgoalSteps++;
      budget.step();

      const verdict = stall.verdict();
      if (verdict.stalled) {
        emit({ type: "escalate", step, from: "B", to: "H", reason: verdict.reason ?? "stalled" });
        emit({ type: "subgoal.end", subgoalId: subgoal.id, state: "unsatisfied", steps: subgoalSteps });
        return finish("stuck", verdict.reason ?? "stalled");
      }

      const outcome = await decideAndAct({
        deps,
        cfg,
        task,
        subgoal,
        snapshot,
        step,
        history,
        triedNoEffect,
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
      });
      modeCounts.B = (modeCounts.B ?? 0) + 1;
      timings.push(timing);
      emit({ type: "step.end", step, timing, mode: "B" });

      if (outcome.kind === "end") {
        emit({ type: "subgoal.end", subgoalId: subgoal.id, state: "unsatisfied", steps: subgoalSteps });
        return finish(outcome.outcome, outcome.reason);
      }
      if (outcome.kind === "continue" && "refused" in outcome) refusals++;
      if (refusals >= cfg.maxConsecutiveRefusals) {
        emit({ type: "escalate", step, from: "B", to: "H", reason: `${refusals} consecutive refusals` });
        emit({ type: "subgoal.end", subgoalId: subgoal.id, state: "unsatisfied", steps: subgoalSteps });
        return finish("stuck", `${refusals} consecutive steps refused by gates`);
      }
    }
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
  stall: StallDetector;
  timing: StepTiming;
  clock: Clock;
  log: Logger;
  onDecision: (costUsd: number) => void;
  onGoalDone: (p: number) => void;
}

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

async function decideAndAct(ctx: DecideContext): Promise<DecideOutcome> {
  const { deps, cfg, task, subgoal, snapshot, step, history, clock } = ctx;
  const triedHere = new Set(
    [...ctx.triedNoEffect].filter((k) => ctx.stall.triedHere(k)).map((k) => k.split("|")[1] ?? ""),
  );
  const candidates = buildCandidates(snapshot, { seedTargets: subgoal.seedTargets, triedHere });
  const textOptions = buildTextOptions(`${subgoal.goal}\n${task.instruction}`, task.secrets, deps.secrets);
  const { questions, offered } = buildActQuestions({ candidates, textOptions });

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
      },
      deps.secrets,
    );
  }

  let t = clock.now();
  const r = await ask(ctx, "act", state, questions);
  ctx.timing.decideMs = clock.now() - t;
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
    return refuse();
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
  const effect = combineEffect(element, modelEffect);

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
    history.push({
      step,
      text: `refused ${operation} (${gates
        .filter((g) => !g.passed)
        .map((g) => g.gate)
        .join(", ")})`,
    });
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
  deps.events.emit({
    type: "action",
    step,
    action,
    target: {
      stableId: element.stableId,
      role: element.role,
      name: element.name,
      ...(element.automationId ? { automationId: element.automationId } : {}),
    },
    mode: "B",
  });
  t = clock.now();
  const result = await execute(deps.computer, action);
  ctx.timing.actMs = clock.now() - t;
  deps.events.emit({ type: "effect", step, result });
  if (result.effect === "suspected_noop" || result.effect === "refused") ctx.triedNoEffect.add(key);
  history.push({
    step,
    text: `${describe} (${result.effect}${result.error ? `: ${result.error.kind}` : ""})`,
  });
  return { kind: "continue" };
}

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
  const options: TextOption[] = buildTextOptions(
    `${ctx.subgoal.goal}\n${ctx.task.instruction}`,
    ctx.task.secrets,
    ctx.deps.secrets,
  );
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
  const r = await ask(ctx, "act", state, questions);
  if (!r.ok) return undefined;
  const picks = Object.values(r.value.answers)
    .filter((a): a is Extract<Answer, { type: "choice" }> => a.type === "choice" && a.choice !== NONE)
    .filter((a) => choiceConfidence(a) >= ctx.cfg.gates.target);
  if (picks.length !== 1 || !picks[0]) return undefined;
  const idx = Number(picks[0].choice.slice(1));
  return options[idx];
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
