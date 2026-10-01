// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { Answer, DecisionProvider, Plan, RunEventDraft } from "@ghosthand/protocol";
import { ok, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { runTask } from "./loop.ts";
import type { Planner, PlanOutput, ReplanInput } from "./planner.ts";
import { SecretsRegistry } from "./secrets.ts";
import { FakeLoginComputer } from "./testing/fake-login-computer.ts";

const blocked: DecisionProvider = {
  id: "fake",
  capabilities: { maxOptions: 255, maxLevels: 10, contextTokens: 64000, zdr: true },
  async ask(_s, questions) {
    const answers: Record<string, Answer> = {};
    for (const k of Object.keys(questions)) answers[k] = { type: "abstain", reason: "unused" };
    answers.operation = {
      type: "choice",
      choice: "blocked",
      confidence: 0.9,
      probabilities: { blocked: 0.9, press: 0.1 },
    };
    answers.stuck = { type: "noul", p: 0.1 };
    return ok({
      answers,
      model: "fake",
      provider: "fake",
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: 0,
      latencyMs: 1,
      calibration: "native" as const,
    });
  },
};

const reachable: Plan = {
  source: "planner",
  subgoals: [
    {
      id: "see-login",
      goal: "Be on the sign-in page",
      doneWhen: { all: [{ kind: "text", text: "Sign in to continue" }], none: [] },
      allowedEffects: ["advance"],
      maxSteps: 5,
      seedTargets: [],
    },
  ],
};
const unreachable: Plan = {
  source: "planner",
  subgoals: [
    {
      ...reachable.subgoals[0]!,
      id: "impossible",
      doneWhen: { all: [{ kind: "text", text: "never shown" }], none: [] },
    },
  ],
};
const out = (plan: Plan): PlanOutput => ({
  plan,
  draft: { subgoals: [] } as never,
  planner: "fake-planner",
  model: "codex",
  latencyMs: 5000,
});

function setup(planner: Planner, withPlan: boolean) {
  const secrets = new SecretsRegistry();
  const computer = new FakeLoginComputer({ email: "a@b.co", passwordSecret: "PW", secrets });
  const events: RunEventDraft[] = [];
  const task = TaskSpec.parse({
    id: "c",
    instruction: "Open the sign-in page",
    startUrl: "http://127.0.0.1:4400/login",
    ...(withPlan ? { plan: unreachable } : {}),
  });
  return { secrets, computer, events, task, planner };
}

describe("mode C (planner + Jev)", () => {
  it("plans from the first screen when the task has no plan", async () => {
    const planner: Planner = {
      id: "fake-planner",
      plan: async () => ok(out(reachable)),
      replan: async () => ok(out(reachable)),
    };
    const { secrets, computer, events, task } = setup(planner, false);
    const r = await runTask(task, {
      computer,
      decision: blocked,
      secrets,
      planner,
      events: { emit: (d) => events.push(d) },
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(r.modelCalls).toBe(1);
    expect(r.decisionCalls).toBe(0);
    expect(events.find((e) => e.type === "plan")).toMatchObject({ plan: reachable });
  });

  it("replans a failed subgoal with the failure reason and history, at most twice", async () => {
    const seen: ReplanInput[] = [];
    const planner: Planner = {
      id: "fake-planner",
      plan: async () => ok(out(reachable)),
      replan: async (input) => {
        seen.push(input);
        return ok(out(reachable));
      },
    };
    const { secrets, computer, events, task } = setup(planner, true);
    const r = await runTask(task, {
      computer,
      decision: blocked,
      secrets,
      planner,
      events: { emit: (d) => events.push(d) },
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.failedSubgoalId).toBe("impossible");
    expect(seen[0]?.failureReason).toContain("refused");
    expect(seen[0]?.history.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "escalate" && e.to === "C")).toBe(true);

    const looping: Planner = { ...planner, replan: async () => ok(out(unreachable)) };
    const again = setup(looping, true);
    const r2 = await runTask(again.task, {
      computer: again.computer,
      decision: blocked,
      secrets: again.secrets,
      planner: looping,
      events: { emit: () => {} },
      config: { screenshots: false },
    });
    expect(r2.outcome).toBe("stuck");
    expect(r2.modelCalls).toBe(2);
  });
});
