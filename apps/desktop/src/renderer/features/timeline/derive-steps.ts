// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Folds a run's events into per-step rows for the timeline (live and replay use the same code).
import type { Answer, Rect, RouterMode, RunEvent, StepTiming } from "@ghosthand/protocol";

type EventOf<T extends RunEvent["type"]> = Extract<RunEvent, { type: T }>;

export interface AnswerView {
  head: string;
  kind: Answer["type"];
  /** Choice key, "yes"/"no" for noul, or the abstain reason. */
  value: string;
  confidence?: number;
  /** Highest probabilities first (choice/score), at most 4. */
  top: Array<{ key: string; p: number }>;
}

export interface DecisionView {
  purpose: string;
  model: string;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  error?: string;
  answers: AnswerView[];
}

export interface StepView {
  step: number;
  url?: string;
  elementCount?: number;
  hasScreenshot: boolean;
  mode?: RouterMode;
  decisions: DecisionView[];
  gates: Array<{ gate: string; passed: boolean; detail?: string }>;
  action?: {
    type: string;
    summary: string;
    target?: { role: string; name: string; bounds?: Rect; confidence?: number };
  };
  effect?: { effect: string; route: string; error?: string; durationMs: number };
  verify?: { state: string; decidedBy: string };
  calls: Array<{
    role: string;
    model: string;
    latencyMs: number;
    ok: boolean;
    costUsd?: number;
    summary?: string;
  }>;
  human: Array<{ kind: string; detail: string; granted?: boolean }>;
  escalations: Array<{ from: string; to: string; reason: string }>;
  timing?: StepTiming;
  costUsd: number;
  /** Rough state for the row marker. */
  status: "acted" | "refused" | "verified" | "pending" | "noop";
}

export interface RunHeader {
  runId?: string;
  instruction?: string;
  taskId?: string;
  startUrl?: string;
  decisionModel?: string;
  surface?: string;
  subgoals: Array<{ id: string; goal: string; state?: string }>;
  end?: EventOf<"run.end">;
  startedAt?: number;
}

function answerView(head: string, a: Answer): AnswerView {
  switch (a.type) {
    case "noul":
      return { head, kind: "noul", value: a.p >= 0.5 ? "yes" : "no", confidence: a.p, top: [] };
    case "choice":
    case "score": {
      const top = Object.entries(a.probabilities)
        .map(([key, p]) => ({ key, p }))
        .sort((x, y) => y.p - x.p)
        .slice(0, 4);
      return {
        head,
        kind: a.type,
        value: a.type === "choice" ? a.choice : String(Math.round(a.score * 100) / 100),
        confidence: a.confidence,
        top,
      };
    }
    case "abstain":
      return { head, kind: "abstain", value: a.reason, top: [] };
  }
}

/** Heads in reading order: operation, then targets, text, effect, then the rest. */
const HEAD_ORDER = (h: string): number =>
  h === "operation" ? 0 : h.endsWith("_target") ? 1 : h === "text" ? 2 : h === "effect" ? 3 : 4;

function describeAction(e: EventOf<"action">): string {
  const a = e.action;
  const name = e.target ? `${e.target.role} “${e.target.name}”` : "";
  switch (a.type) {
    case "set_value":
      return `set ${name} ← ${typeof a.value === "string" ? JSON.stringify(a.value) : `[input:${a.value.secretRef}]`}`;
    case "select_option":
      return `select “${a.option}” in ${name}`;
    case "navigate":
      return `navigate ${a.url}`;
    default:
      return `${a.type.replace("_", " ")} ${name}`.trim();
  }
}

function emptyStep(step: number): StepView {
  return {
    step,
    hasScreenshot: false,
    decisions: [],
    gates: [],
    calls: [],
    human: [],
    escalations: [],
    costUsd: 0,
    status: "pending",
  };
}

export function deriveRun(events: readonly RunEvent[]): { header: RunHeader; steps: StepView[] } {
  const header: RunHeader = { subgoals: [] };
  const steps = new Map<number, StepView>();
  const purposes = new Map<number, string>();
  const at = (n: number): StepView => {
    let s = steps.get(n);
    if (!s) {
      s = emptyStep(n);
      steps.set(n, s);
    }
    return s;
  };
  for (const e of events) {
    switch (e.type) {
      case "run.start":
        header.runId = e.runId;
        header.instruction = e.task.instruction;
        header.taskId = e.task.id;
        header.startUrl = e.task.startUrl;
        header.decisionModel = e.decisionModel;
        header.surface = e.surface;
        header.startedAt = e.t;
        break;
      case "plan":
        header.subgoals = e.plan.subgoals.map((g) => ({ id: g.id, goal: g.goal }));
        break;
      case "subgoal.end": {
        const g = header.subgoals.find((x) => x.id === e.subgoalId);
        if (g) g.state = e.state;
        break;
      }
      case "run.end":
        header.end = e;
        break;
      case "observe": {
        const s = at(e.step);
        if (e.url !== undefined) s.url = e.url;
        s.elementCount = e.elementCount;
        s.hasScreenshot = s.hasScreenshot || e.screenshot !== undefined;
        break;
      }
      case "decision.request":
        at(e.step);
        purposes.set(e.step, e.purpose);
        break;
      case "decision.answer": {
        const s = at(e.step);
        s.costUsd += e.costUsd;
        s.decisions.push({
          purpose: purposes.get(e.step) ?? "verify",
          model: e.model,
          latencyMs: e.latencyMs,
          costUsd: e.costUsd,
          inputTokens: e.inputTokens,
          ...(e.error ? { error: `${e.error.kind}: ${e.error.message}` } : {}),
          answers: Object.entries(e.answers ?? {})
            .map(([h, a]) => answerView(h, a))
            .sort((a, b) => HEAD_ORDER(a.head) - HEAD_ORDER(b.head)),
        });
        break;
      }
      case "model.call": {
        if (e.step === undefined) break;
        const s = at(e.step);
        s.costUsd += e.costUsd ?? 0;
        s.calls.push({
          role: e.role,
          model: e.model,
          latencyMs: e.latencyMs,
          ok: e.ok,
          ...(e.costUsd !== undefined ? { costUsd: e.costUsd } : {}),
          ...(e.summary !== undefined ? { summary: e.summary } : {}),
        });
        break;
      }
      case "gate":
        at(e.step).gates.push({ gate: e.gate, passed: e.passed, ...(e.detail ? { detail: e.detail } : {}) });
        break;
      case "action": {
        const s = at(e.step);
        s.mode = e.mode;
        s.action = {
          type: e.action.type,
          summary: describeAction(e),
          ...(e.target
            ? {
                target: {
                  role: e.target.role,
                  name: e.target.name,
                  ...(e.target.bounds ? { bounds: e.target.bounds } : {}),
                  ...(e.target.confidence !== undefined ? { confidence: e.target.confidence } : {}),
                },
              }
            : {}),
        };
        break;
      }
      case "effect":
        at(e.step).effect = {
          effect: e.result.effect,
          route: e.result.route,
          durationMs: e.result.durationMs,
          ...(e.result.error ? { error: `${e.result.error.kind}: ${e.result.error.message}` } : {}),
        };
        break;
      case "verify":
        at(e.step).verify = { state: e.state, decidedBy: e.decidedBy };
        break;
      case "escalate":
        at(e.step).escalations.push({ from: e.from, to: e.to, reason: e.reason });
        break;
      case "human":
        at(e.step).human.push({
          kind: e.kind,
          detail: e.detail,
          ...(e.granted !== undefined ? { granted: e.granted } : {}),
        });
        break;
      case "step.end": {
        const s = at(e.step);
        s.timing = e.timing;
        s.mode = e.mode;
        break;
      }
      case "subgoal.start":
        break;
    }
  }
  for (const s of steps.values()) {
    s.status = s.effect
      ? s.effect.effect === "suspected_noop" || s.effect.effect === "refused"
        ? "noop"
        : "acted"
      : s.gates.some((g) => !g.passed)
        ? "refused"
        : s.verify?.state === "satisfied"
          ? "verified"
          : "pending";
  }
  // Step 0 holds only pre-loop verification; hide it when empty.
  return {
    header,
    steps: [...steps.values()]
      .filter((s) => s.step > 0 || s.decisions.length > 0)
      .sort((a, b) => a.step - b.step),
  };
}

export const TIMING_PARTS = ["settleMs", "observeMs", "decideMs", "actMs", "verifyMs"] as const;
