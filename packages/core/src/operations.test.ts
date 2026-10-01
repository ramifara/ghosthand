// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// drag, context_menu and scroll operations (L4 hard DOM).
import { RunEvent, type RunEventDraft, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { buildCandidates, DROP_HEAD } from "./candidates.ts";
import { runTask } from "./loop.ts";
import { PAGE } from "./questions.ts";
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

const task = (goal: string, done: string) =>
  TaskSpec.parse({
    id: "op",
    instruction: goal,
    startUrl: "http://127.0.0.1:4400/lab",
    plan: {
      source: "task",
      subgoals: [
        {
          id: "s",
          goal,
          doneWhen: { all: [{ kind: "text", text: done }], none: [] },
          allowedEffects: ["advance", "commit"],
        },
      ],
    },
  });

describe("drag", () => {
  const screens: Record<string, ScriptedScreen> = {
    board: {
      url: "http://127.0.0.1:4400/lab/kanban",
      title: "Board",
      elements: [
        fakeElement("e1", { role: "listitem", name: "Fix login bug", actions: ["drag"] }),
        fakeElement("e2", { role: "list", name: "To do", actions: ["drop"] }),
        fakeElement("e3", { role: "list", name: "Done", actions: ["drop"] }),
      ],
    },
    moved: { url: "http://127.0.0.1:4400/lab/kanban", title: "Board", text: "Moved to Done", elements: [] },
  };

  it("offers drag only with a drop zone and drags source onto the chosen target", async () => {
    const computer = new ScriptedComputer({
      screens,
      start: "board",
      transition: (a) =>
        a.type === "drag" &&
        "token" in a.from &&
        a.from.token === "e1" &&
        "token" in a.to &&
        a.to.token === "e3"
          ? "moved"
          : undefined,
    });
    const decision = new FnDecisionProvider((q) =>
      q.operation
        ? {
            operation: choiceOf(q, "operation", "drag"),
            drag_target: choiceOf(q, "drag_target", "e1"),
            [DROP_HEAD]: choiceOf(q, DROP_HEAD, "e3"),
            effect: choiceOf(q, "effect", "advance"),
            goal_done: noulOf(0.1),
            stuck: noulOf(0.05),
          }
        : {},
    );
    const s = sink();
    const r = await runTask(task('Move "Fix login bug" to Done', "Moved to Done"), {
      computer,
      decision,
      events: s,
      secrets: new SecretsRegistry(),
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(computer.actions[0]).toEqual({ type: "drag", from: { token: "e1" }, to: { token: "e3" } });
    const asked = decision.requests[0]?.questions;
    expect(Object.keys(asked?.[DROP_HEAD]?.type === "choice" ? asked[DROP_HEAD].criteria : {})).toContain(
      "e3",
    );
  });

  it("does not offer drag when nothing accepts a drop", () => {
    const board = screens.board as ScriptedScreen;
    const table = buildCandidates({
      id: "s",
      surface: "web",
      takenAt: 0,
      title: "",
      viewport: { x: 0, y: 0, width: 1, height: 1 },
      elements: board.elements.filter((e) => !e.actions.includes("drop")),
      text: "",
      tokenEstimate: 1,
      quality: { elementCount: 1, unnamedInteractive: 0, score: 1 },
      narrowed: false,
    });
    expect(table.drag).toEqual([]);
    expect(table.scroll).toEqual([]);
  });
});

describe("context_menu", () => {
  it("right-clicks the chosen row, then presses the menu item", async () => {
    const computer = new ScriptedComputer({
      screens: {
        files: {
          url: "u",
          title: "Files",
          elements: [fakeElement("e1", { role: "row", name: "report.pdf", actions: ["context_menu"] })],
        },
        menu: {
          url: "u",
          title: "Files",
          elements: [fakeElement("e2", { role: "menuitem", name: "Archive", actions: ["press"] })],
        },
        done: { url: "u", title: "Files", text: "report.pdf archived", elements: [] },
      },
      start: "files",
      transition: (a, screen) =>
        screen === "files" && a.type === "click" && a.button === "right"
          ? "menu"
          : screen === "menu" && a.type === "press"
            ? "done"
            : undefined,
    });
    const decision = new FnDecisionProvider((q) => {
      if (!q.operation) return {};
      const ctx = Boolean(q.context_menu_target);
      return {
        operation: choiceOf(q, "operation", ctx ? "context_menu" : "press"),
        ...(ctx
          ? { context_menu_target: choiceOf(q, "context_menu_target", "e1") }
          : { press_target: choiceOf(q, "press_target", "e2") }),
        effect: choiceOf(q, "effect", "advance"),
        goal_done: noulOf(0.1),
        stuck: noulOf(0.05),
      };
    });
    const r = await runTask(task("Archive report.pdf", "report.pdf archived"), {
      computer,
      decision,
      events: sink(),
      secrets: new SecretsRegistry(),
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(computer.actions[0]).toEqual({ type: "click", target: { token: "e1" }, button: "right" });
  });
});

describe("scroll", () => {
  it("is offered only when the snapshot can scroll, and scrolls near the chosen element or the page", async () => {
    const computer = new ScriptedComputer({
      screens: {
        feed: {
          url: "u",
          title: "Feed",
          canScroll: true,
          elements: [fakeElement("e1", { role: "article", name: "Post 1", actions: ["press"] })],
        },
        more: {
          url: "u",
          title: "Feed",
          canScroll: true,
          elements: [
            fakeElement("e1", { role: "article", name: "Post 1", actions: ["press"] }),
            fakeElement("e9", { role: "button", name: "Star Post 40", actions: ["press"] }),
          ],
        },
        starred: { url: "u", title: "Feed", text: "Post 40 starred", elements: [] },
      },
      start: "feed",
      transition: (a, screen) =>
        a.type === "scroll"
          ? screen === "feed"
            ? "more"
            : undefined
          : a.type === "press"
            ? "starred"
            : undefined,
    });
    let calls = 0;
    const decision = new FnDecisionProvider((q) => {
      if (!q.operation) return {};
      calls++;
      return calls === 1
        ? {
            operation: choiceOf(q, "operation", "scroll"),
            scroll_target: choiceOf(q, "scroll_target", PAGE),
            effect: choiceOf(q, "effect", "advance"),
            goal_done: noulOf(0.1),
            stuck: noulOf(0.05),
          }
        : {
            operation: choiceOf(q, "operation", "press"),
            press_target: choiceOf(q, "press_target", "e9"),
            effect: choiceOf(q, "effect", "advance"),
            goal_done: noulOf(0.1),
            stuck: noulOf(0.05),
          };
    });
    const r = await runTask(task("Star Post 40", "Post 40 starred"), {
      computer,
      decision,
      events: sink(),
      secrets: new SecretsRegistry(),
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(computer.actions[0]).toEqual({ type: "scroll", dx: 0, dy: 600 });
    const first = decision.requests[0]?.questions.scroll_target;
    expect(first?.type === "choice" ? Object.keys(first.criteria) : []).toContain(PAGE);
  });
});
