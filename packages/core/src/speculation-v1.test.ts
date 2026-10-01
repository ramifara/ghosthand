// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Speculation v1: the planner refines later subgoals while Jev executes the current one; the refinement is
// applied only when the current subgoal ends satisfied and the plan did not change, and discarded otherwise.
import { ok, type Plan, RunEvent, type RunEventDraft, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { runTask } from "./loop.ts";
import type { Planner, PlanOutput, RefineInput } from "./planner.ts";
import { SecretsRegistry } from "./secrets.ts";
import { choiceOf, FnDecisionProvider, noulOf } from "./testing/fn-decision-provider.ts";
import { fakeElement, ScriptedComputer } from "./testing/scripted-computer.ts";

function sink() {
  const events: RunEvent[] = [];
  let seq = 0;
  return {
    events,
    emit: (d: RunEventDraft) => {
      events.push(RunEvent.parse({ ...d, t: seq, seq: seq++, runId: "t" }));
    },
  };
}

const sg = (id: string, text: string) => ({
  id,
  goal: `reach ${text}`,
  doneWhen: { all: [{ kind: "text" as const, text }], none: [] },
  allowedEffects: ["advance" as const],
  maxSteps: 5,
  seedTargets: [],
});

const plan: Plan = { source: "planner", subgoals: [sg("s1", "Page B"), sg("s2", "Page C (old guess)")] };

function planner(
  refine: (input: RefineInput) => Promise<ReturnType<typeof ok<PlanOutput>>>,
): Planner & { refined: RefineInput[] } {
  const refined: RefineInput[] = [];
  const out = (p: Plan): PlanOutput => ({
    plan: p,
    draft: { subgoals: [] },
    planner: "mock",
    latencyMs: 1,
    costUsd: 0.001,
  });
  return {
    id: "mock",
    refined,
    plan: async () => ok(out(plan)),
    replan: async () => ok(out(plan)),
    refine: (input) => {
      refined.push(input);
      return refine(input);
    },
  };
}

const computer = () =>
  new ScriptedComputer({
    screens: {
      a: { url: "u", title: "A", elements: [fakeElement("e1", { role: "button", name: "Next" })] },
      b: {
        url: "u",
        title: "B",
        text: "Page B",
        elements: [fakeElement("e2", { role: "button", name: "Next" })],
      },
      c: { url: "u", title: "C", text: "Page C", elements: [] },
    },
    start: "a",
    transition: (a, s) => (a.type === "press" ? (s === "a" ? "b" : "c") : undefined),
  });

const decision = () =>
  new FnDecisionProvider((q) =>
    q.operation
      ? {
          operation: choiceOf(q, "operation", "press"),
          press_target: choiceOf(
            q,
            "press_target",
            Object.keys(q.press_target?.type === "choice" ? q.press_target.criteria : {})[0] ?? "none",
          ),
          effect: choiceOf(q, "effect", "advance"),
          goal_done: noulOf(0.1),
          stuck: noulOf(0.05),
        }
      : {},
  );

const task = TaskSpec.parse({ id: "adhoc", instruction: "Go to page C", startUrl: "http://x.test/" });

describe("speculation v1 (plan refinement)", () => {
  it("applies a refinement that is ready when the current subgoal succeeds", async () => {
    const p = planner(async () =>
      ok({
        plan: { source: "planner", subgoals: [sg("s2b", "Page C")] },
        draft: { subgoals: [] },
        planner: "mock",
        latencyMs: 1,
        costUsd: 0.001,
      }),
    );
    const s = sink();
    const r = await runTask(task, {
      computer: computer(),
      decision: decision(),
      events: s,
      secrets: new SecretsRegistry(),
      planner: p,
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(p.refined).toHaveLength(1);
    expect(p.refined[0]?.currentSubgoalId).toBe("s1");
    const plans = s.events.filter((e) => e.type === "plan");
    expect(plans.at(-1)?.type === "plan" && plans.at(-1)?.plan.subgoals.map((g) => g.id)).toEqual([
      "s1",
      "s2b",
    ]);
    expect(
      s.events.some(
        (e) => e.type === "model.call" && e.summary?.startsWith("speculative refinement applied"),
      ),
    ).toBe(true);
  });

  it("discards a refinement that is not ready, without waiting for it", async () => {
    const p = planner(() => new Promise(() => {}));
    const s = sink();
    const r = await runTask(task, {
      computer: computer(),
      decision: decision(),
      events: s,
      secrets: new SecretsRegistry(),
      planner: p,
      config: { screenshots: false },
    });
    // The old s2 ("Page C (old guess)") never holds, so the run does not succeed, but it was not blocked.
    expect(r.outcome).not.toBe("success");
    expect(s.events.some((e) => e.type === "model.call" && e.summary?.includes("discarded: not ready"))).toBe(
      true,
    );
  });

  it("does not refine when disabled", async () => {
    const p = planner(async () => {
      throw new Error("should not be called");
    });
    await runTask(task, {
      computer: computer(),
      decision: decision(),
      events: sink(),
      secrets: new SecretsRegistry(),
      planner: p,
      config: { screenshots: false, refinePlan: false, maxReplans: 0 },
    });
    expect(p.refined).toHaveLength(0);
  });
});
