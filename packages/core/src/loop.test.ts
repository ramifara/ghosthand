// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { readFileSync } from "node:fs";
import { RunEvent, type RunEventDraft, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { runTask } from "./loop.ts";
import { SecretsRegistry } from "./secrets.ts";
import { FakeLoginComputer } from "./testing/fake-login-computer.ts";
import { type Recording, ScriptedDecisionProvider } from "./testing/scripted-decision-provider.ts";

const recording = JSON.parse(
  readFileSync(new URL("./__recordings__/l1-login.json", import.meta.url), "utf8"),
) as Recording;

const PASSWORD = "correct-horse-7";

function setup(rec: Recording = recording) {
  const secrets = new SecretsRegistry([["TESTBED_PASSWORD", PASSWORD]]);
  const computer = new FakeLoginComputer({
    email: "alice@testbed.local",
    passwordSecret: "TESTBED_PASSWORD",
    secrets,
  });
  const decision = new ScriptedDecisionProvider(rec);
  const events: RunEvent[] = [];
  let seq = 0;
  const sink = {
    emit: (d: RunEventDraft) => {
      events.push(RunEvent.parse({ ...d, t: seq, seq: seq++, runId: "test" }));
    },
  };
  const task = TaskSpec.parse({
    id: "l1-login",
    instruction: "Sign in as alice@testbed.local with the stored password",
    startUrl: "http://127.0.0.1:4400/login",
    secrets: ["TESTBED_PASSWORD"],
    plan: {
      source: "task",
      subgoals: [
        {
          id: "login",
          goal: "Sign in as alice@testbed.local with the stored password",
          doneWhen: { all: [{ kind: "url", matches: "/home" }], none: [] },
          allowedEffects: ["advance", "commit"],
        },
      ],
    },
  });
  return { secrets, computer, decision, events, sink, task };
}

describe("runTask (mode B, recorded decisions, no network)", () => {
  it("logs in with three Jev decisions and records valid events without the secret", async () => {
    const { computer, decision, events, sink, task, secrets } = setup();
    const r = await runTask(task, { computer, decision, events: sink, secrets });
    expect(r.outcome).toBe("success");
    expect(r.steps).toBe(3);
    expect(r.decisionCalls).toBe(3);
    expect(computer.actions).toEqual(["set_value e3", "set_value e4", "press e5"]);
    expect(computer.loggedIn).toBe(true);
    expect(r.modeShares).toEqual({ B: 1 });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("plan");
    expect(types.at(-1)).toBe("run.end");
    expect(types.filter((t) => t === "action")).toHaveLength(3);
    const serialized = JSON.stringify(events) + JSON.stringify(decision.requests);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).toContain("[input:TESTBED_PASSWORD]");
  });

  it("refuses a commit that the subgoal does not allow and ends stuck after repeated refusals", async () => {
    const { computer, decision, sink, task, secrets, events } = setup({
      ...recording,
      calls: [recording.calls[2], recording.calls[2], recording.calls[2]].filter((c) => c !== undefined),
    });
    const first = task.plan?.subgoals[0];
    if (!first) throw new Error("fixture");
    first.allowedEffects = ["advance"];
    const r = await runTask(task, { computer, decision, events: sink, secrets });
    expect(r.outcome).toBe("stuck");
    expect(computer.actions).toEqual([]);
    expect(events.some((e) => e.type === "gate" && e.gate === "effect_allowed" && !e.passed)).toBe(true);
  });

  it("asks for approval for a non-allowed commit and runs it when granted", async () => {
    const { computer, decision, sink, task, secrets, events } = setup();
    const first = task.plan?.subgoals[0];
    if (!first) throw new Error("fixture");
    first.allowedEffects = ["advance"];
    const asked: string[] = [];
    const r = await runTask(task, {
      computer,
      decision,
      events: sink,
      secrets,
      approve: async (req) => {
        asked.push(req.action.type);
        return true;
      },
    });
    expect(r.outcome).toBe("success");
    expect(asked).toEqual(["press"]);
    expect(events.some((e) => e.type === "human" && e.granted === true)).toBe(true);
  });

  it("stops when the step budget runs out", async () => {
    const { computer, decision, sink, task, secrets } = setup();
    const r = await runTask(
      { ...task, budget: { ...task.budget, steps: 2 } },
      { computer, decision, events: sink, secrets },
    );
    expect(r.outcome).toBe("budget_exhausted");
    expect(r.steps).toBe(2);
  });
});
