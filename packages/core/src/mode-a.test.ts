// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Mode A inside a run: recipe replay with guards, heal, fallback to mode B, final checks re-run.
import { RunEvent, type RunEventDraft, type Snapshot, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { runTask } from "./loop.ts";
import type { RecipeBook, RecipeMatch } from "./recipe.ts";
import { SecretsRegistry } from "./secrets.ts";
import { choiceOf, FnDecisionProvider, noulOf } from "./testing/fn-decision-provider.ts";
import { fakeElement, ScriptedComputer, type ScriptedScreen } from "./testing/scripted-computer.ts";

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

const task = TaskSpec.parse({
  id: "l1-login",
  instruction: "Sign in as alice@testbed.local with the password [input:PW]",
  startUrl: "http://127.0.0.1:4400/login",
  secrets: ["PW"],
  plan: {
    source: "task",
    subgoals: [
      {
        id: "login",
        goal: "Sign in",
        doneWhen: { all: [{ kind: "text", text: "Signed in as alice@testbed.local" }], none: [] },
        allowedEffects: ["advance", "commit"],
      },
    ],
  },
});

function loginScreens(submit = "Sign in"): Record<string, ScriptedScreen> {
  const form = [
    fakeElement("e1", { role: "textbox", name: "Email", actions: ["set_value"] }),
    fakeElement("e2", { role: "textbox", name: "Password", actions: ["set_value"] }),
    fakeElement("e3", { role: "button", name: submit, actions: ["press"], risk: "submits" }),
  ];
  return {
    login: { url: "http://127.0.0.1:4400/login", title: "Sign in", elements: form },
    home: {
      url: "http://127.0.0.1:4400/",
      title: "Home",
      text: "Signed in as alice@testbed.local",
      elements: [fakeElement("e9", { role: "button", name: "Sign out" })],
    },
  };
}

const computerFor = (screens: Record<string, ScriptedScreen>) =>
  new ScriptedComputer({
    screens,
    start: "login",
    transition: (a, screen) => (screen === "login" && a.type === "press" ? "home" : "login"),
  });

const match: RecipeMatch = {
  recipeId: "r1",
  version: 1,
  intent: "Sign in as {{email}}",
  trust: 0.8,
  params: { email: "alice@testbed.local" },
  steps: [
    {
      action: { type: "set_value", token: "x", value: "alice@testbed.local" },
      target: { stableId: "textbox|Email", role: "textbox", name: "Email" },
      effect: "advance",
    },
    {
      action: { type: "set_value", token: "x", value: { secretRef: "PW" } },
      target: { stableId: "textbox|Password", role: "textbox", name: "Password" },
      effect: "advance",
    },
    {
      action: { type: "press", token: "x" },
      target: { stableId: "button|Sign in", role: "button", name: "Sign in" },
      effect: "commit",
    },
  ],
};

const book = (m: RecipeMatch | undefined): RecipeBook & { seen: Snapshot[] } => {
  const seen: Snapshot[] = [];
  return {
    seen,
    match: (_t, s) => {
      seen.push(s);
      return m;
    },
  };
};

const unusedDecision = () =>
  new FnDecisionProvider(() => {
    throw new Error("no decision expected");
  });

describe("mode A in runTask", () => {
  it("replays a matching recipe with zero decision calls and re-runs the final checks", async () => {
    const computer = computerFor(loginScreens());
    const s = sink();
    const recipes = book(match);
    const r = await runTask(task, {
      computer,
      decision: unusedDecision(),
      events: s,
      secrets: new SecretsRegistry([["PW", "pw-123"]]),
      recipes,
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(r.decisionCalls).toBe(0);
    expect(r.modeShares).toEqual({ A: 1 });
    expect(r.replay).toMatchObject({ recipeId: "r1", replayed: 3, total: 3, heals: [] });
    expect(recipes.seen).toHaveLength(1);
    expect(computer.actions.map((a) => a.type)).toEqual(["set_value", "set_value", "press"]);
    expect(s.events.some((e) => e.type === "verify" && e.state === "satisfied")).toBe(true);
    expect(
      s.events.filter((e) => e.type === "action").every((e) => e.type === "action" && e.mode === "A"),
    ).toBe(true);
  });

  it("heals a renamed control with one Jev question", async () => {
    const computer = computerFor(loginScreens("Log in"));
    const decision = new FnDecisionProvider((q) =>
      q.same_control ? { same_control: choiceOf(q, "same_control", "e3") } : {},
    );
    const r = await runTask(task, {
      computer,
      decision,
      events: sink(),
      secrets: new SecretsRegistry([["PW", "pw-123"]]),
      recipes: book(match),
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(r.decisionCalls).toBe(1);
    expect(r.replay?.heals).toEqual([
      { index: 2, target: { stableId: "button|Log in", role: "button", name: "Log in" } },
    ]);
    expect(r.modeShares.A).toBeCloseTo(2 / 3);
    expect(r.modeShares.B).toBeCloseTo(1 / 3);
  });

  it("falls back to mode B for the rest when a guard fails", async () => {
    const computer = computerFor(loginScreens("Continue"));
    const decision = new FnDecisionProvider((q) => {
      if (q.same_control) return { same_control: choiceOf(q, "same_control", "none") };
      if (!q.operation) return {};
      return {
        operation: choiceOf(q, "operation", "press"),
        press_target: choiceOf(q, "press_target", "e3"),
        effect: choiceOf(q, "effect", "commit"),
        goal_done: noulOf(0.1),
        stuck: noulOf(0.05),
      };
    });
    const s = sink();
    const r = await runTask(task, {
      computer,
      decision,
      events: s,
      secrets: new SecretsRegistry([["PW", "pw-123"]]),
      recipes: book(match),
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(r.replay?.fellBackAt).toBe(2);
    expect(r.modeShares.A).toBeGreaterThan(0);
    expect(r.modeShares.B).toBeGreaterThan(0);
    expect(s.events.some((e) => e.type === "escalate" && e.from === "A" && e.to === "B")).toBe(true);
  });

  it("refuses to replay a commit when the task does not allow commits", async () => {
    const advanceOnly = TaskSpec.parse({
      ...task,
      plan: { source: "task", subgoals: [{ ...task.plan?.subgoals[0], allowedEffects: ["advance"] }] },
    });
    const decision = new FnDecisionProvider((q) =>
      q.operation
        ? {
            operation: choiceOf(q, "operation", "blocked"),
            effect: choiceOf(q, "effect", "advance"),
            goal_done: noulOf(0.1),
            stuck: noulOf(0.95),
          }
        : {},
    );
    const r = await runTask(advanceOnly, {
      computer: computerFor(loginScreens()),
      decision,
      events: sink(),
      secrets: new SecretsRegistry([["PW", "pw-123"]]),
      recipes: book(match),
      config: { screenshots: false },
    });
    expect(r.replay?.fellBackAt).toBe(2);
    expect(r.replay?.reason).toContain("does not allow commits");
  });
});
