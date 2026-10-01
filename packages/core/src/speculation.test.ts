// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { Answer, DecisionProvider, Questions, RunEventDraft } from "@ghosthand/protocol";
import { ok, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { runTask } from "./loop.ts";
import { SecretsRegistry } from "./secrets.ts";
import { FakeLoginComputer } from "./testing/fake-login-computer.ts";

const LATENCY = 80;
const choice = (c: string, p = 0.95): Answer => ({
  type: "choice",
  choice: c,
  confidence: p,
  probabilities: { [c]: p, none: 1 - p },
});

/** Answers from the fake page's state, with a fixed latency, like a real provider would. */
function pageAwareProvider(computer: FakeLoginComputer): DecisionProvider & { calls: number } {
  const p = {
    id: "fake",
    calls: 0,
    capabilities: { maxOptions: 255, maxLevels: 10, contextTokens: 64000, zdr: true },
    async ask(_state: unknown, questions: Questions) {
      p.calls++;
      await new Promise((r) => setTimeout(r, LATENCY));
      const answers: Record<string, Answer> = {};
      if (questions.holds) answers.holds = { type: "noul", p: computer.loggedIn ? 0.95 : 0.1 };
      if (questions.operation) {
        const next = !computer.email
          ? ["set_value", "e3", "lit_1"]
          : !computer.password
            ? ["set_value", "e4", "sec_1"]
            : ["press", "e5", "none"];
        answers.operation = choice(next[0] ?? "");
        answers[`${next[0]}_target`] = choice(next[1] ?? "");
        if (questions.text) answers.text = choice(next[2] ?? "");
        answers.effect = choice(next[0] === "press" ? "commit" : "advance");
        answers.goal_done = { type: "noul", p: 0.6 };
        answers.stuck = { type: "noul", p: 0.01 };
        for (const k of Object.keys(questions)) answers[k] ??= { type: "abstain", reason: "unused head" };
      }
      return ok({
        answers,
        model: "fake",
        provider: "fake",
        usage: { inputTokens: 100, outputTokens: 1 },
        costUsd: 0,
        latencyMs: LATENCY,
        calibration: "native" as const,
      });
    },
  };
  return p;
}

async function run(speculate: boolean) {
  const secrets = new SecretsRegistry([["TESTBED_PASSWORD", "pw-123456"]]);
  const computer = new FakeLoginComputer({
    email: "alice@testbed.local",
    passwordSecret: "TESTBED_PASSWORD",
    secrets,
  });
  const decision = pageAwareProvider(computer);
  const events: RunEventDraft[] = [];
  const task = TaskSpec.parse({
    id: "spec",
    instruction: "Sign in as alice@testbed.local with the stored password",
    startUrl: "http://127.0.0.1:4400/login",
    secrets: ["TESTBED_PASSWORD"],
    plan: {
      source: "task",
      subgoals: [
        {
          id: "login",
          goal: "Sign in as alice@testbed.local with the stored password",
          doneWhen: { all: [{ kind: "model", criteria: "The user is signed in" }], none: [] },
          allowedEffects: ["advance", "commit"],
        },
      ],
    },
  });
  const r = await runTask(task, {
    computer,
    decision,
    secrets,
    events: { emit: (d) => events.push(d) },
    config: { speculate, screenshots: false },
  });
  return { r, calls: decision.calls, computer };
}

describe("speculation (P1-10)", () => {
  it("overlaps the verify check with the next decision and still finishes correctly", async () => {
    const serial = await run(false);
    const spec = await run(true);
    for (const x of [serial, spec]) {
      expect(x.r.outcome).toBe("success");
      expect(x.computer.actions).toEqual(["set_value e3", "set_value e4", "press e5"]);
    }
    // Serial: 3 act calls + 3 verify calls (steps 2, 3 and the final check). Speculative adds one
    // discarded decision on the final check.
    expect(serial.calls).toBe(6);
    expect(spec.calls).toBe(7);
    // Two of the three verify checks overlap a decision: ~2 × LATENCY saved.
    expect(serial.r.wallMs - spec.r.wallMs).toBeGreaterThan(LATENCY);
    const medianDecide = (t: { decideMs: number; verifyMs: number }[]) =>
      t.map((x) => x.decideMs + x.verifyMs).sort((a, b) => a - b)[1] ?? 0;
    expect(medianDecide(spec.r.timings)).toBeLessThan(medianDecide(serial.r.timings));
  });
});
