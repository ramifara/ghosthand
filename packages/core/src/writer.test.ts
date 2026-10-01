// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { Answer, DecisionProvider, Entry, Questions, RunEventDraft } from "@ghosthand/protocol";
import { ok, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { runTask } from "./loop.ts";
import { SecretsRegistry } from "./secrets.ts";
import { FakeLoginComputer } from "./testing/fake-login-computer.ts";
import type { Writer, WriterInput } from "./writer.ts";

const choice = (c: string, p: number): Answer => ({
  type: "choice",
  choice: c,
  confidence: p,
  probabilities: { [c]: p, none: 1 - p },
});

/** Jev is unsure about the Sign in button unless its state carries a hint. */
function unsureProvider(): DecisionProvider & { states: Entry[] } {
  const states: Entry[] = [];
  return {
    id: "fake",
    states,
    capabilities: { maxOptions: 255, maxLevels: 10, contextTokens: 64000, zdr: true },
    async ask(state: Entry, questions: Questions) {
      states.push(state);
      const hinted = JSON.stringify(state).includes('"hint"');
      const answers: Record<string, Answer> = {};
      for (const k of Object.keys(questions)) answers[k] = { type: "abstain", reason: "unused" };
      answers.operation = choice("press", 0.9);
      answers.press_target = choice("e5", hinted ? 0.94 : 0.41);
      answers.effect = choice("commit", 0.9);
      answers.goal_done = { type: "noul", p: 0.1 };
      answers.stuck = { type: "noul", p: 0.05 };
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
}

function setup(hint: Writer["hint"]) {
  const secrets = new SecretsRegistry([["TESTBED_PASSWORD", "pw-123456"]]);
  const computer = new FakeLoginComputer({ email: "a@b.co", passwordSecret: "TESTBED_PASSWORD", secrets });
  computer.email = "a@b.co";
  computer.password = "pw-123456";
  const events: RunEventDraft[] = [];
  const calls: WriterInput[] = [];
  const writer: Writer = {
    id: "writer:test",
    hint: (input, opts) => {
      calls.push(input);
      return hint(input, opts);
    },
  };
  const task = TaskSpec.parse({
    id: "w",
    instruction: "Sign in",
    startUrl: "http://127.0.0.1:4400/login",
    secrets: ["TESTBED_PASSWORD"],
    plan: {
      source: "task",
      subgoals: [
        {
          id: "s",
          goal: "Sign in",
          doneWhen: { all: [{ kind: "url", matches: "/home" }], none: [] },
          allowedEffects: ["advance", "commit"],
        },
      ],
    },
  });
  return { secrets, computer, events, calls, writer, task };
}

describe("writer hand-off (P1-04)", () => {
  it("re-asks Jev with the writer's focus hint and proceeds", async () => {
    const { secrets, computer, events, calls, writer, task } = setup(async () =>
      ok({
        hint: { kind: "focus", focus: "Press the Sign in button" },
        model: "gpt-test",
        latencyMs: 900,
        costUsd: 0.001,
      }),
    );
    const decision = unsureProvider();
    const r = await runTask(task, {
      computer,
      decision,
      secrets,
      writer,
      events: { emit: (d) => events.push(d) },
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(r.modelCalls).toBe(1);
    expect(calls[0]?.reason).toContain("target_confidence");
    expect(JSON.stringify(calls[0])).not.toContain("pw-123456");
    expect(JSON.stringify(decision.states.at(-1))).toContain("Press the Sign in button");
    expect(events.some((e) => e.type === "model.call" && e.role === "writer" && e.ok)).toBe(true);
    expect(computer.actions).toEqual(["press e5"]);
  });

  it("escalates to a replan after two hand-offs without progress", async () => {
    const { secrets, computer, events, writer, task } = setup(async () =>
      ok({ hint: { kind: "focus", focus: "Look around" }, model: "gpt-test", latencyMs: 1, costUsd: 0 }),
    );
    const never: DecisionProvider = {
      ...unsureProvider(),
      async ask(state, questions) {
        const r = await unsureProvider().ask(state, questions);
        if (r.ok) r.value.answers.press_target = choice("e5", 0.3);
        return r;
      },
    };
    const r = await runTask(task, {
      computer,
      decision: never,
      secrets,
      writer,
      events: { emit: (d) => events.push(d) },
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("stuck");
    expect(r.reason).toContain("needs replan");
    expect(r.modelCalls).toBe(2);
    expect(events.some((e) => e.type === "escalate" && e.to === "C")).toBe(true);
  });
});
