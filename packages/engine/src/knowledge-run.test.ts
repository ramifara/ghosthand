// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// afterRun: learning only when asked and only from passing runs; replay outcomes update trust.
import {
  choiceOf,
  FnDecisionProvider,
  fakeElement,
  noulOf,
  runTask,
  ScriptedComputer,
  SecretsRegistry,
} from "@ghosthand/core";
import { openKnowledge } from "@ghosthand/knowledge";
import { RunEvent, type RunEventDraft, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { afterRun } from "./knowledge-run.ts";

const task = TaskSpec.parse({
  id: "l9-demo",
  instruction: 'Rename the project to "Apollo".',
  startUrl: "http://127.0.0.1:4400/projects",
  plan: {
    source: "task",
    subgoals: [
      {
        id: "s",
        goal: "rename",
        doneWhen: { all: [{ kind: "text", text: "Saved" }], none: [] },
        allowedEffects: ["advance", "commit"],
      },
    ],
  },
});

async function run(kb: ReturnType<typeof openKnowledge> & { ok: true }, recipes: boolean) {
  const events: RunEvent[] = [];
  let seq = 0;
  const sink = {
    emit: (d: RunEventDraft) => events.push(RunEvent.parse({ ...d, t: seq, seq: seq++, runId: "r" })),
  };
  sink.emit({ type: "run.start", task, decisionModel: "fn", surface: "scripted" });
  const session = kb.value.session(task.startUrl);
  const computer = new ScriptedComputer({
    screens: {
      edit: {
        url: "http://127.0.0.1:4400/projects",
        title: "Projects",
        elements: [
          fakeElement("f", { role: "textbox", name: "Project name", actions: ["set_value"] }),
          fakeElement("b", { role: "button", name: "Save", actions: ["press"] }),
        ],
      },
      saved: { url: "http://127.0.0.1:4400/projects", title: "Projects", text: "Saved", elements: [] },
    },
    start: "edit",
    transition: (a) => (a.type === "press" ? "saved" : a.type === "set_value" ? "edit" : undefined),
  });
  let n = 0;
  const decision = new FnDecisionProvider((q) => {
    if (!q.operation) return {};
    n++;
    return n === 1
      ? {
          operation: choiceOf(q, "operation", "set_value"),
          set_value_target: choiceOf(q, "set_value_target", "f"),
          text: choiceOf(q, "text", "lit_1"),
          effect: choiceOf(q, "effect", "advance"),
          goal_done: noulOf(0.1),
          stuck: noulOf(0.1),
        }
      : {
          operation: choiceOf(q, "operation", "press"),
          press_target: choiceOf(q, "press_target", "b"),
          effect: choiceOf(q, "effect", "commit"),
          goal_done: noulOf(0.1),
          stuck: noulOf(0.1),
        };
  });
  const result = await runTask(task, {
    computer,
    decision,
    events: sink,
    secrets: new SecretsRegistry(),
    onSnapshot: session.onSnapshot,
    ...(recipes ? { recipes: kb.value.book() } : {}),
    config: { screenshots: false },
  });
  return { result, events, session };
}

describe("afterRun", () => {
  it("learns a recipe and the app map only with learn on and a passing run", async () => {
    const kb = openKnowledge({ path: ":memory:" });
    if (!kb.ok) throw new Error(kb.error.message);
    const first = await run(kb, false);
    const off = afterRun(
      { kb: kb.value, learn: false, recipes: false },
      { runId: "r1", task, events: first.events, passed: true, replay: undefined, session: first.session },
    );
    expect(off.skipped).toContain("learning is off");
    const failed = afterRun(
      { kb: kb.value, learn: true, recipes: false },
      { runId: "r1", task, events: first.events, passed: false, replay: undefined, session: first.session },
    );
    expect(failed.skipped).toContain("did not pass");
    const on = afterRun(
      { kb: kb.value, learn: true, recipes: true },
      { runId: "r1", task, events: first.events, passed: true, replay: undefined, session: first.session },
    );
    expect(on.learned).toMatchObject({ id: "127.0.0.1:4400/l9-demo", version: 1, created: true });
    expect(on.mapped?.screens).toBeGreaterThan(0);

    const second = await run(kb, true);
    expect(second.result.decisionCalls).toBe(0);
    const after = afterRun(
      { kb: kb.value, learn: true, recipes: true },
      {
        runId: "r2",
        task,
        events: second.events,
        passed: true,
        replay: second.result.replay,
        session: second.session,
      },
    );
    expect(after.recipeUsed?.replayed).toBe(2);
    expect(after.skipped).toBe("the recipe replayed cleanly");
    const stored = kb.value.recipes.get("127.0.0.1:4400/l9-demo");
    expect(stored.ok && stored.value.successes).toBe(2);
    kb.value.close();
  });
});
