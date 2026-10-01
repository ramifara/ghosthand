// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The judge chain per expectation: deterministic (code, oracle, HTTP) → Jev `holds` (separate request) →
// vision reviewer on the screenshot → inconclusive. The loop's own verify events are reused first, so a
// verdict the loop already reached is never asked again. The agent's "done" is never a verdict.
import { buildState, evaluateDeterministic, HOLDS_FAIL, HOLDS_PASS, holdsQuestion } from "@ghosthand/core";
import type { DecisionProvider, Predicate, RunEvent, VerifyState } from "@ghosthand/protocol";
import type { CaseExecution, Checkpoint } from "./case-execution.ts";
import type { CompiledQaExpect, CompiledStep } from "./compile-spec.ts";
import { evaluateQaCheck } from "./qa-checks.ts";
import type { DecidedBy, ExpectResult, StepResult, StepStatus } from "./report-schema.ts";
import type { VisionJudge } from "./vision-judge.ts";

export interface JudgeDeps {
  decision?: DecisionProvider;
  vision?: VisionJudge;
  signal?: AbortSignal;
}

/** Cost and evidence produced while judging (added to the step's totals). */
interface JudgeSpend {
  costUsd: number;
  inputTokens: number;
  modelInputs: string[];
}

type SubgoalEvents = { started: boolean; ended: VerifyState | undefined; events: RunEvent[] };

export function subgoalEvents(events: RunEvent[], subgoalId: string): SubgoalEvents {
  const start = events.findIndex((e) => e.type === "subgoal.start" && e.subgoalId === subgoalId);
  if (start < 0) return { started: false, ended: undefined, events: [] };
  let end = events.findIndex((e, i) => i > start && e.type === "subgoal.end" && e.subgoalId === subgoalId);
  if (end < 0) end = events.length - 1;
  const slice = events.slice(start, end + 1);
  const last = slice[slice.length - 1];
  return { started: true, ended: last?.type === "subgoal.end" ? last.state : undefined, events: slice };
}

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : val,
  );

/** The most recent state the loop recorded for this predicate within the subgoal. */
function loopState(sub: SubgoalEvents, p: Predicate): { state: VerifyState; by: DecidedBy } | undefined {
  const key = canonical(p);
  for (let i = sub.events.length - 1; i >= 0; i--) {
    const e = sub.events[i];
    if (e?.type !== "verify") continue;
    const hit = e.predicates.find((x) => canonical(x.predicate) === key);
    if (!hit || hit.state === "unknown") continue;
    const by: DecidedBy =
      p.kind === "oracle"
        ? "oracle"
        : p.kind === "model"
          ? e.decidedBy === "vision"
            ? "vision"
            : "jev"
          : "deterministic";
    return { state: hit.state, by };
  }
  return undefined;
}

const invert = (s: VerifyState): VerifyState =>
  s === "satisfied" ? "unsatisfied" : s === "unsatisfied" ? "satisfied" : "unknown";

interface ExpectContext {
  exec: CaseExecution;
  sub: SubgoalEvents | undefined;
  subgoalId: string | undefined;
  checkpoint: Checkpoint | undefined;
  goal: string;
  deps: JudgeDeps;
  spend: JudgeSpend;
  tag: string;
}

/** Jev holds, then vision, for a model-checked criterion. */
async function modelChain(
  criteria: string,
  ctx: ExpectContext,
  base: Omit<ExpectResult, "state" | "decidedBy" | "detail">,
): Promise<ExpectResult> {
  const recorded = [...ctx.exec.holds]
    .reverse()
    .find((h) => h.criteria === criteria && h.subgoalId === ctx.subgoalId && h.p !== undefined);
  let p = recorded?.p;
  let detail = p === undefined ? "" : `loop holds p=${p.toFixed(2)}`;
  const snapshot = ctx.checkpoint?.snapshot;
  if (p === undefined && ctx.deps.decision && snapshot) {
    const state = buildState({
      instruction: ctx.goal,
      goal: ctx.goal,
      step: 0,
      phase: "verify",
      snapshot,
      history: [],
      inputs: [],
    });
    const file = ctx.exec.writeEvidence?.(`qa-${ctx.tag}-holds.json`, state);
    if (file) ctx.spend.modelInputs.push(file);
    const r = await ctx.deps.decision.ask(
      state,
      { holds: holdsQuestion(criteria) },
      ctx.deps.signal ? { signal: ctx.deps.signal } : {},
    );
    if (r.ok) {
      ctx.spend.costUsd += r.value.costUsd;
      ctx.spend.inputTokens += r.value.usage.inputTokens;
      const a = r.value.answers.holds;
      p = a?.type === "noul" ? a.p : undefined;
      detail = p === undefined ? "jev abstained" : `jev holds p=${p.toFixed(2)}`;
    } else detail = `jev error ${r.error.kind}`;
  }
  if (p !== undefined && p >= HOLDS_PASS)
    return { ...base, state: "satisfied", decidedBy: "jev", confidence: p, detail };
  if (p !== undefined && p <= HOLDS_FAIL)
    return { ...base, state: "unsatisfied", decidedBy: "jev", confidence: 1 - p, detail };
  return visionChain([criteria], ctx, base, detail);
}

async function visionChain(
  criteria: string[],
  ctx: ExpectContext,
  base: Omit<ExpectResult, "state" | "decidedBy" | "detail">,
  prior: string,
): Promise<ExpectResult> {
  const shot = ctx.checkpoint?.screenshot;
  const join = (s: string) => (prior ? `${prior}; ${s}` : s);
  if (!ctx.deps.vision || !shot)
    return {
      ...base,
      state: "unknown",
      decidedBy: "none",
      detail: join(ctx.deps.vision ? "no screenshot" : "no vision reviewer configured"),
    };
  const r = await ctx.deps.vision.check({
    criteria,
    image: { data: shot, mediaType: "image/png" },
    context: ctx.goal,
    ...(ctx.deps.signal ? { signal: ctx.deps.signal } : {}),
  });
  if (!r.ok)
    return {
      ...base,
      state: "unknown",
      decidedBy: "none",
      detail: join(`vision ${r.error.kind}: ${r.error.message}`),
    };
  ctx.spend.costUsd += r.value.costUsd;
  if (ctx.checkpoint?.screenshotFile) ctx.spend.modelInputs.push(ctx.checkpoint.screenshotFile);
  const v = r.value.verdicts[0];
  if (!v) return { ...base, state: "unknown", decidedBy: "none", detail: join("vision returned no verdict") };
  return {
    ...base,
    state: v.state,
    decidedBy: v.state === "unknown" ? "none" : "vision",
    confidence: v.confidence,
    detail: join(`vision (${r.value.model}): ${v.detail}`),
  };
}

async function judgeExpect(e: CompiledQaExpect, ctx: ExpectContext): Promise<ExpectResult> {
  const base = { source: e.source, line: e.line, kind: e.kind } as const;
  const snapshot = ctx.checkpoint?.snapshot;
  switch (e.kind) {
    case "qa": {
      const r = evaluateQaCheck(e.check, snapshot, ctx.exec.errors);
      return {
        ...base,
        state: e.negated ? invert(r.state) : r.state,
        decidedBy: r.state === "unknown" ? "none" : "deterministic",
        detail: r.detail,
      };
    }
    case "http": {
      const pass = ctx.exec.checks.http ? await ctx.exec.checks.http(e.predicate) : undefined;
      if (pass === undefined)
        return { ...base, state: "unknown", decidedBy: "none", detail: "no HTTP checker" };
      const s: VerifyState = pass ? "satisfied" : "unsatisfied";
      return {
        ...base,
        state: e.negated ? invert(s) : s,
        decidedBy: "deterministic",
        detail: `${e.predicate.method} ${e.predicate.url}`,
      };
    }
    case "vision":
      return visionChain([e.criteria], ctx, base, "visual step");
    case "loop": {
      const seen = ctx.sub ? loopState(ctx.sub, e.predicate) : undefined;
      if (seen) return { ...base, state: seen.state, decidedBy: seen.by, detail: `loop verify (${seen.by})` };
      const p = e.predicate;
      if (p.kind === "model") return modelChain(p.criteria, ctx, base);
      if (p.kind === "oracle") {
        const pass = ctx.exec.checks.oracle ? await ctx.exec.checks.oracle(p.taskId) : undefined;
        if (pass === undefined)
          return { ...base, state: "unknown", decidedBy: "none", detail: "oracle unavailable" };
        const s: VerifyState = pass ? "satisfied" : "unsatisfied";
        return {
          ...base,
          state: e.negated ? invert(s) : s,
          decidedBy: "oracle",
          detail: `oracle ${p.taskId}`,
        };
      }
      if (!snapshot) return { ...base, state: "unknown", decidedBy: "none", detail: "no snapshot" };
      const s = evaluateDeterministic(p, snapshot) ?? "unknown";
      return {
        ...base,
        state: e.negated ? invert(s) : s,
        decidedBy: s === "unknown" ? "none" : "deterministic",
        detail: "checked on the step-end snapshot",
      };
    }
    default:
      return { ...base, state: "unknown", decidedBy: "none", detail: "unsupported" };
  }
}

/** Decided-by precedence for a passed step: the most model-dependent link is reported. */
const WEAKEST: DecidedBy[] = ["none", "vision", "jev", "oracle", "deterministic"];

function rollUp(results: ExpectResult[]): {
  state: VerifyState;
  by: DecidedBy;
  confidence?: number;
  detail: string;
} {
  const failed = results.find((r) => r.state === "unsatisfied");
  if (failed)
    return {
      state: "unsatisfied",
      by: failed.decidedBy,
      ...(failed.confidence !== undefined ? { confidence: failed.confidence } : {}),
      detail: `expect failed (line ${failed.line}): ${failed.source}: ${failed.detail}`,
    };
  const unknown = results.find((r) => r.state === "unknown");
  if (unknown)
    return {
      state: "unknown",
      by: "none",
      detail: `inconclusive (line ${unknown.line}): ${unknown.source}: ${unknown.detail}`,
    };
  const by = WEAKEST.find((w) => results.some((r) => r.decidedBy === w)) ?? "none";
  const confs = results.map((r) => r.confidence).filter((c): c is number => c !== undefined);
  return {
    state: "satisfied",
    by,
    ...(confs.length > 0 ? { confidence: Math.min(...confs) } : {}),
    detail: `${results.length} expectation(s) held`,
  };
}

export async function judgeStep(
  step: CompiledStep & { line: number },
  exec: CaseExecution,
  deps: JudgeDeps,
): Promise<{ result: StepResult; spend: { costUsd: number; inputTokens: number } }> {
  const sub = subgoalEvents(exec.events, step.subgoalId);
  const spend: JudgeSpend = { costUsd: 0, inputTokens: 0, modelInputs: [] };
  const checkpoint: Checkpoint | undefined =
    sub.ended === "satisfied"
      ? (exec.checkpoints[step.subgoalId] ?? exec.final)
      : (exec.final ?? exec.checkpoints[step.subgoalId]);
  const stats = stepStats(sub.events);
  for (const e of sub.events)
    if (e.type === "decision.request" && e.stateFile && !spend.modelInputs.includes(e.stateFile))
      spend.modelInputs.push(e.stateFile);
  spend.modelInputs.splice(0, Math.max(0, spend.modelInputs.length - 2));
  const evidence = {
    ...(checkpoint?.screenshotFile ? { screenshotFile: checkpoint.screenshotFile } : {}),
    ...(checkpoint?.url ? { url: checkpoint.url } : {}),
    modelInputs: spend.modelInputs,
  };
  const common = {
    index: step.index,
    line: step.line,
    perform: step.perform,
    flag: step.flag,
    decisive: step.decisive,
    agentSteps: stats.steps,
    wallMs: stats.wallMs,
  };
  if (!sub.started)
    return {
      result: {
        ...common,
        status: "blocked",
        decidedBy: "none",
        detail: `not reached: the run ended earlier (${exec.outcome}: ${exec.reason})`,
        expects: [],
        evidence,
        costUsd: 0,
        inputTokens: 0,
      },
      spend: { costUsd: 0, inputTokens: 0 },
    };

  const ctx: ExpectContext = {
    exec,
    sub,
    subgoalId: step.subgoalId,
    checkpoint,
    goal: step.perform,
    deps,
    spend,
    tag: `step-${step.index}`,
  };
  const results: ExpectResult[] = [];
  if (step.performOnly) {
    // No expectation reached the loop: the step's own action is the claim.
    const r =
      sub.ended === "satisfied"
        ? loopPerform(sub, step.perform)
        : await modelChain(step.perform, ctx, { source: step.perform, line: step.line, kind: "perform" });
    results.push(r);
  }
  for (const e of step.expects) results.push(await judgeExpect(e, ctx));
  const roll = rollUp(results);
  let status: StepStatus =
    roll.state === "satisfied" ? "passed" : roll.state === "unsatisfied" ? "failed" : "inconclusive";
  let detail = roll.detail;
  if (sub.ended !== "satisfied" && status === "passed") {
    // The loop gave up but every check holds on the final page: report it, but do not count it decisive.
    status = "inconclusive";
    detail = `the loop did not finish the step (${exec.reason}) although its expectations hold on the final page`;
  }
  if (!step.decisive) {
    detail = `advisory (${step.flag}): ${status}; ${detail}`;
    status = "advisory";
  }
  return {
    result: {
      ...common,
      status,
      decidedBy: roll.by,
      ...(roll.confidence !== undefined ? { confidence: roll.confidence } : {}),
      detail,
      expects: results,
      evidence: { ...evidence, modelInputs: spend.modelInputs },
      costUsd: stats.costUsd + spend.costUsd,
      inputTokens: stats.inputTokens + spend.inputTokens,
    },
    spend: { costUsd: spend.costUsd, inputTokens: spend.inputTokens },
  };
}

function loopPerform(sub: SubgoalEvents, perform: string): ExpectResult {
  const last = [...sub.events].reverse().find((e) => e.type === "verify");
  const by: DecidedBy = last?.type === "verify" && last.decidedBy === "vision" ? "vision" : "jev";
  return {
    source: perform,
    line: 0,
    kind: "perform",
    state: "satisfied",
    decidedBy: by,
    detail: "loop verify said the step is done",
  };
}

function stepStats(events: RunEvent[]): {
  steps: number;
  wallMs: number;
  costUsd: number;
  inputTokens: number;
} {
  const first = events[0];
  const last = events[events.length - 1];
  let costUsd = 0;
  let inputTokens = 0;
  let steps = 0;
  for (const e of events) {
    if (e.type === "decision.answer") {
      costUsd += e.costUsd;
      inputTokens += e.inputTokens;
    }
    if (e.type === "model.call") costUsd += e.costUsd ?? 0;
    if (e.type === "step.end") steps++;
    if (e.type === "subgoal.end") steps = Math.max(steps, e.steps);
  }
  return { steps, wallMs: first && last ? Math.max(0, last.t - first.t) : 0, costUsd, inputTokens };
}

/** Case-level expects, judged on the final page after the last step. */
export async function judgeCaseExpects(
  expects: CompiledQaExpect[],
  exec: CaseExecution,
  deps: JudgeDeps,
  goal: string,
): Promise<{ results: ExpectResult[]; costUsd: number; inputTokens: number }> {
  const spend: JudgeSpend = { costUsd: 0, inputTokens: 0, modelInputs: [] };
  const ctx: ExpectContext = {
    exec,
    sub: undefined,
    subgoalId: undefined,
    checkpoint: exec.final,
    goal,
    deps,
    spend,
    tag: "case",
  };
  const results: ExpectResult[] = [];
  for (const e of expects) results.push(await judgeExpect(e, ctx));
  return { results, costUsd: spend.costUsd, inputTokens: spend.inputTokens };
}
