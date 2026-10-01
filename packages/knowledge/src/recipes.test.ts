// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Learn → store → match → replay (mode A, zero calls) → trust, heal patch and retirement.
import {
  choiceOf,
  FnDecisionProvider,
  fakeElement,
  noulOf,
  runTask,
  ScriptedComputer,
  type ScriptedScreen,
  SecretsRegistry,
} from "@ghosthand/core";
import { RunEvent, type RunEventDraft, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { openKnowledge } from "./knowledge.ts";
import { afterFailure, effectiveTrust, INITIAL_TRUST, usable } from "./trust.ts";

const APP = "http://127.0.0.1:4400";

const settingsTask = (limit: number) =>
  TaskSpec.parse({
    id: "adhoc",
    instruction: `Open Notifications, set the daily email limit to ${limit} and save.`,
    startUrl: `${APP}/settings`,
    plan: {
      source: "task",
      subgoals: [
        {
          id: "s",
          goal: "save notifications",
          doneWhen: { all: [{ kind: "text", text: "Notification settings saved" }], none: [] },
          allowedEffects: ["advance", "commit"],
        },
      ],
    },
  });

function screens(saveLabel = "Save notifications"): Record<string, ScriptedScreen> {
  return {
    general: {
      url: `${APP}/settings`,
      title: "Settings",
      elements: [
        fakeElement("h1", { role: "heading", name: "Settings" }),
        fakeElement("t1", { role: "tab", name: "General", actions: ["press"] }),
        fakeElement("t2", { role: "tab", name: "Notifications", actions: ["press"] }),
      ],
    },
    notifications: {
      url: `${APP}/settings`,
      title: "Settings",
      elements: [
        fakeElement("h1", { role: "heading", name: "Settings" }),
        fakeElement("t1", { role: "tab", name: "General", actions: ["press"] }),
        fakeElement("t2", { role: "tab", name: "Notifications", actions: ["press"] }),
        fakeElement("f1", { role: "textbox", name: "Daily email limit", actions: ["set_value"] }),
        fakeElement("b1", { role: "button", name: saveLabel, actions: ["press"], risk: "submits" }),
      ],
    },
    saved: {
      url: `${APP}/settings`,
      title: "Settings",
      text: "Notification settings saved",
      elements: [fakeElement("h1", { role: "heading", name: "Settings" })],
    },
  };
}

function computer(saveLabel?: string) {
  return new ScriptedComputer({
    screens: screens(saveLabel),
    start: "general",
    transition: (a, s) => {
      if (s === "general" && a.type === "press" && a.token === "t2") return "notifications";
      if (s === "notifications" && a.type === "set_value") return "notifications";
      if (s === "notifications" && a.type === "press" && a.token === "b1") return "saved";
      return undefined;
    },
  });
}

/** A mode-B run with a scripted Jev: tab → type limit → save. */
async function learnRun(limit: number) {
  const events: RunEvent[] = [];
  let seq = 0;
  const sink = {
    emit: (d: RunEventDraft) => events.push(RunEvent.parse({ ...d, t: seq, seq: seq++, runId: "r1" })),
  };
  const task = settingsTask(limit);
  sink.emit({ type: "run.start", task, decisionModel: "fn", surface: "scripted" });
  let call = 0;
  const decision = new FnDecisionProvider((q) => {
    if (!q.operation) return {};
    call++;
    const pick =
      call === 1
        ? { operation: choiceOf(q, "operation", "press"), press_target: choiceOf(q, "press_target", "t2") }
        : call === 2
          ? {
              operation: choiceOf(q, "operation", "set_value"),
              set_value_target: choiceOf(q, "set_value_target", "f1"),
              text: choiceOf(q, "text", "lit_1"),
            }
          : { operation: choiceOf(q, "operation", "press"), press_target: choiceOf(q, "press_target", "b1") };
    return {
      ...pick,
      effect: choiceOf(q, "effect", call === 3 ? "commit" : "advance"),
      goal_done: noulOf(0.1),
      stuck: noulOf(0.05),
    };
  });
  const c = computer();
  const r = await runTask(task, {
    computer: c,
    decision,
    events: sink,
    secrets: new SecretsRegistry(),
    config: { screenshots: false },
  });
  return { r, events };
}

describe("recipes", () => {
  it("learns from a verified run, then replays a new parameter with zero decision calls", async () => {
    const k = openKnowledge({ path: ":memory:" });
    if (!k.ok) throw new Error(k.error.message);
    const { r, events } = await learnRun(45);
    expect(r.outcome).toBe("success");
    const learned = k.value.learn(events, { runId: "r1", now: 1000 });
    if (!learned.ok) throw new Error(learned.error.message);
    const recipe = learned.value.recipe;
    expect(recipe.intent).toBe("Open Notifications, set the daily email limit to {{p1}} and save.");
    expect(recipe.steps.map((s) => s.action.type)).toEqual(["press", "set_value", "press"]);
    expect(recipe.steps[1]?.action).toMatchObject({ value: "{{p1}}" });
    expect(recipe.steps[2]?.effect).toBe("commit");

    const book = k.value.book({ now: () => 2000 });
    const c = computer();
    const replay = await runTask(settingsTask(30), {
      computer: c,
      decision: new FnDecisionProvider(() => {
        throw new Error("no decision expected");
      }),
      events: { emit: () => {} },
      secrets: new SecretsRegistry(),
      recipes: book,
      config: { screenshots: false },
    });
    expect(replay.outcome).toBe("success");
    expect(replay.decisionCalls).toBe(0);
    expect(replay.modeShares).toEqual({ A: 1 });
    expect(c.actions[1]).toMatchObject({ type: "set_value", value: "30" });

    // Outcome: success raises trust.
    const after = k.value.recordOutcome(
      recipe.id,
      {
        runId: "r2",
        ok: true,
        replay: replay.replay ?? { recipeId: "", version: 1, total: 0, replayed: 0, heals: [] },
      },
      3000,
    );
    expect(after.ok && after.value.trust).toBeGreaterThan(INITIAL_TRUST);
    k.value.close();
  });

  it("patches a healed target into a new version and retires after two failures", async () => {
    const k = openKnowledge({ path: ":memory:" });
    if (!k.ok) throw new Error(k.error.message);
    const { events } = await learnRun(45);
    const learned = k.value.learn(events, { runId: "r1", now: 1000 });
    if (!learned.ok) throw new Error(learned.error.message);
    const id = learned.value.recipe.id;
    const c = computer("Save");
    const decision = new FnDecisionProvider((q) =>
      q.same_control ? { same_control: choiceOf(q, "same_control", "b1") } : {},
    );
    const run = await runTask(settingsTask(12), {
      computer: c,
      decision,
      events: { emit: () => {} },
      secrets: new SecretsRegistry(),
      recipes: k.value.book({ now: () => 2000 }),
      config: { screenshots: false },
    });
    expect(run.outcome).toBe("success");
    expect(run.decisionCalls).toBe(1);
    const healed = k.value.recordOutcome(
      id,
      {
        runId: "r2",
        ok: true,
        replay: run.replay ?? { recipeId: id, version: 1, total: 3, replayed: 0, heals: [] },
      },
      3000,
    );
    if (!healed.ok) throw new Error(healed.error.message);
    expect(healed.value.version).toBe(2);
    expect(healed.value.steps[2]?.target?.name).toBe("Save");
    expect(healed.value.heals).toBe(1);

    const fail = {
      runId: "r3",
      ok: false,
      replay: { recipeId: id, version: 2, total: 3, replayed: 1, heals: [], fellBackAt: 1 },
    };
    k.value.recordOutcome(id, fail, 4000);
    const twice = k.value.recordOutcome(id, fail, 5000);
    expect(twice.ok && twice.value.status).toBe("retired");
    // A retired recipe is not matched.
    const s = await computer().observe();
    if (!s.ok) throw new Error("observe");
    expect(k.value.book({ now: () => 6000 }).match(settingsTask(5), s.value)).toBeUndefined();
    k.value.close();
  });

  it("does not match another app, another intent or another start screen", async () => {
    const k = openKnowledge({ path: ":memory:" });
    if (!k.ok) throw new Error(k.error.message);
    const { events } = await learnRun(45);
    k.value.learn(events, { runId: "r1", now: 1000 });
    const book = k.value.book({ now: () => 2000 });
    const s = await computer().observe();
    if (!s.ok) throw new Error("observe");
    expect(book.match(settingsTask(9), s.value)).toBeDefined();
    expect(
      book.match({ ...settingsTask(9), startUrl: "http://other.test/settings" }, s.value),
    ).toBeUndefined();
    expect(book.match({ ...settingsTask(9), instruction: "Delete every order." }, s.value)).toBeUndefined();
    expect(book.match(settingsTask(9), { ...s.value, url: `${APP}/orders`, elements: [] })).toBeUndefined();
    k.value.close();
  });
});

describe("trust", () => {
  it("decays with time and drops on failure", () => {
    const base = { trust: 0.6, createdAt: 0, lastSuccessAt: 0 };
    expect(effectiveTrust(base, 0)).toBeCloseTo(0.6);
    expect(effectiveTrust(base, 60 * 86_400_000)).toBeCloseTo(0.3);
    const r = {
      id: "x",
      version: 1,
      app: APP,
      intent: "i",
      params: [],
      startUrl: APP,
      startScreen: { key: "k", urlPattern: APP },
      steps: [{ action: { type: "back" as const }, target: null, effect: "advance" as const }],
      secrets: [],
      status: "active" as const,
      trust: 0.6,
      successes: 1,
      failures: 0,
      consecutiveFailures: 0,
      heals: 0,
      learnedFrom: [],
      createdAt: 0,
      updatedAt: 0,
    };
    expect(usable(r, 0)).toBe(true);
    const once = afterFailure(r, 1);
    expect(once.trust).toBeCloseTo(0.36);
    expect(usable(once, 1)).toBe(true);
    expect(usable(afterFailure(once, 2), 2)).toBe(false);
  });
});
