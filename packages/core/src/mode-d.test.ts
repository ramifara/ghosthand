// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Modes D1 and D2 with a mocked vision provider, and the degrade-to-human path without one.
import { ok, RunEvent, type RunEventDraft, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { runTask } from "./loop.ts";
import { allowedText } from "./mode-d.ts";
import { SecretsRegistry } from "./secrets.ts";
import { choiceOf, FnDecisionProvider, noulOf } from "./testing/fn-decision-provider.ts";
import { fakeElement, ScriptedComputer, type ScriptedScreen } from "./testing/scripted-computer.ts";
import type { DriveAction, VisionAssist } from "./vision.ts";

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

const task = (goal: string, done: string, extra: Partial<TaskSpec> = {}) =>
  TaskSpec.parse({
    id: "d",
    instruction: goal,
    startUrl: "http://127.0.0.1:4400/lab",
    budget: { steps: 12, seconds: 60, usd: 0.25 },
    plan: {
      source: "task",
      subgoals: [
        {
          id: "s",
          goal,
          doneWhen: { all: [{ kind: "text", text: done }], none: [] },
          allowedEffects: ["advance", "commit"],
          maxSteps: 10,
        },
      ],
    },
    ...extra,
  });

const call = { model: "mock-vlm", latencyMs: 5, costUsd: 0.001 };

function mockVision(opts: {
  names?: Record<string, string>;
  point?: { x: number; y: number };
  drive?: DriveAction[];
}) {
  const driven = [...(opts.drive ?? [])];
  const calls: string[] = [];
  const v: VisionAssist & { calls: string[] } = {
    id: "mock",
    calls,
    async ground() {
      calls.push("ground");
      return ok(
        opts.point
          ? { ...call, found: true as const, ...opts.point }
          : { ...call, found: false as const, reason: "no" },
      );
    },
    async nameElements() {
      calls.push("name");
      return ok({ ...call, names: opts.names ?? {} });
    },
    async describe() {
      calls.push("describe");
      return ok({ ...call, text: "42" });
    },
    ...(opts.drive
      ? {
          async drive() {
            calls.push("drive");
            return ok({
              ...call,
              action: driven.shift() ?? { kind: "done" as const, reason: "nothing left" },
            });
          },
        }
      : {}),
  };
  return v;
}

const act = (q: Parameters<typeof choiceOf>[0], op: string, target: string, effect = "advance") => ({
  operation: choiceOf(q, "operation", op),
  [`${op}_target`]: choiceOf(q, `${op}_target`, target),
  effect: choiceOf(q, "effect", effect),
  goal_done: noulOf(0.1),
  stuck: noulOf(0.05),
});

describe("D1 screen-to-text", () => {
  const screens: Record<string, ScriptedScreen> = {
    list: {
      url: "u",
      title: "Files",
      elements: [
        fakeElement("e1", { role: "heading", name: "Files" }),
        fakeElement("e2", { role: "button", name: "", actions: ["press"] }),
        fakeElement("e3", { role: "button", name: "", actions: ["press"] }),
        fakeElement("e4", { role: "button", name: "Upload", actions: ["press"] }),
      ],
    },
    done: { url: "u", title: "Files", text: "report.pdf deleted", elements: [] },
  };
  const computer = () =>
    new ScriptedComputer({
      screens,
      start: "list",
      transition: (a) => (a.type === "press" && a.token === "e3" ? "done" : undefined),
    });

  it("names unlabeled icon buttons with vision, then Jev picks by name", async () => {
    const vision = mockVision({ names: { e2: "Edit", e3: "Delete" } });
    const decision = new FnDecisionProvider((q) => {
      if (!q.operation) return {};
      const press = q.press_target?.type === "choice" ? q.press_target.criteria : {};
      // Before naming, Jev can only guess an unnamed button; after, it picks "Delete".
      const named = JSON.stringify(press).includes("Delete");
      return act(q, "press", named ? "e3" : "e2", "commit");
    });
    const s = sink();
    const r = await runTask(task("Delete report.pdf", "report.pdf deleted"), {
      computer: computer(),
      decision,
      events: s,
      secrets: new SecretsRegistry(),
      vision,
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(vision.calls).toEqual(["name"]);
    expect(r.modeShares).toEqual({ D1: 1 });
    expect(r.modelCalls).toBe(1);
    expect(s.events.some((e) => e.type === "escalate" && e.to === "D1")).toBe(true);
  });

  it("without a vision provider, escalates to H with a clear reason", async () => {
    const decision = new FnDecisionProvider((q) => (q.operation ? act(q, "press", "e2") : {}));
    const s = sink();
    let replans = 0;
    const planner = {
      id: "p",
      plan: async () => {
        throw new Error("not called: the task has a plan");
      },
      replan: async () => {
        replans++;
        throw new Error("a replan cannot supply vision");
      },
    };
    const r = await runTask(task("Delete report.pdf", "report.pdf deleted"), {
      computer: computer(),
      decision,
      events: s,
      secrets: new SecretsRegistry(),
      planner,
      config: { screenshots: false },
    });
    expect(r.outcome).not.toBe("success");
    expect(r.reason).toContain("vision needed");
    expect(r.reason).toContain("OPENAI_API_KEY");
    expect(replans).toBe(0);
    const esc = s.events.filter((e) => e.type === "escalate" && e.to === "H");
    expect(esc[0]?.type === "escalate" && esc[0].reason).toContain("no vision provider is configured");
  });
});

describe("D1 ground", () => {
  it("clicks a point on the capture after Jev finds no target twice on the same screen", async () => {
    const computer = new ScriptedComputer({
      screens: {
        canvas: {
          url: "u",
          title: "Chart",
          elements: [fakeElement("e1", { role: "button", name: "Help", actions: ["press"] })],
        },
        done: { url: "u", title: "Chart", text: "Q3 selected", elements: [] },
      },
      start: "canvas",
      transition: (a) => (a.type === "click" && "captureId" in a.target ? "done" : undefined),
    });
    const vision = mockVision({ point: { x: 400, y: 300 } });
    const decision = new FnDecisionProvider((q) => (q.operation ? act(q, "press", "none") : {}));
    const r = await runTask(task("Select the Q3 bar in the chart", "Q3 selected"), {
      computer,
      decision,
      events: sink(),
      secrets: new SecretsRegistry(),
      vision,
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(vision.calls).toEqual(["ground"]);
    expect(computer.actions.at(-1)).toEqual({ type: "click", target: { captureId: "c1", x: 400, y: 300 } });
    expect(r.modeShares.D1).toBeCloseTo(1 / 2);
  });
});

describe("D2 drive", () => {
  const poor: ScriptedScreen = {
    url: "u",
    title: "Remote desktop",
    elements: [fakeElement("e1", { role: "generic", name: "", actions: ["press"] })],
  };
  const good: ScriptedScreen = {
    url: "u",
    title: "Done",
    text: "Connected",
    elements: [fakeElement("e2", { role: "button", name: "Disconnect", actions: ["press"] })],
  };

  it("drives a poor surface, then de-escalates when the table is good again", async () => {
    const computer = new ScriptedComputer({
      screens: { poor, good },
      start: "poor",
      transition: (a) => (a.type === "click" ? "good" : undefined),
    });
    const vision = mockVision({ drive: [{ kind: "click", x: 10, y: 20 }] });
    const decision = new FnDecisionProvider((q) =>
      q.operation
        ? {
            operation: choiceOf(q, "operation", "blocked"),
            effect: choiceOf(q, "effect", "advance"),
            goal_done: noulOf(0.1),
            stuck: noulOf(0.1),
          }
        : {},
    );
    const s = sink();
    const r = await runTask(task("Connect", "Connected"), {
      computer,
      decision,
      events: s,
      secrets: new SecretsRegistry(),
      vision,
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(vision.calls).toContain("drive");
    expect(r.modeShares.D2).toBeGreaterThan(0);
    expect(s.events.some((e) => e.type === "escalate" && e.to === "D2")).toBe(true);
    expect(computer.actions.some((a) => a.type === "click" && "captureId" in a.target)).toBe(true);
  });

  it("stops for a human on a provider safety check and never acknowledges it", async () => {
    const computer = new ScriptedComputer({ screens: { poor }, start: "poor", transition: () => undefined });
    const vision = mockVision({
      drive: [{ kind: "safety", reason: "pending_safety_checks: malicious instructions" }],
    });
    const decision = new FnDecisionProvider((q) =>
      q.operation
        ? { operation: choiceOf(q, "operation", "blocked"), goal_done: noulOf(0.1), stuck: noulOf(0.1) }
        : {},
    );
    const s = sink();
    const r = await runTask(task("Connect", "Connected"), {
      computer,
      decision,
      events: s,
      secrets: new SecretsRegistry(),
      vision,
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("stuck");
    expect(r.reason).toContain("safety check");
    expect(s.events.some((e) => e.type === "escalate" && e.from === "D2" && e.to === "H")).toBe(true);
    expect(computer.actions.filter((a) => a.type === "click")).toHaveLength(0);
  });

  it("types only goal literals or stored secrets", () => {
    const options = [
      { key: "lit_1", kind: "literal" as const, text: "Alice" },
      { key: "sec_1", kind: "secret" as const, name: "PW" },
    ];
    expect(allowedText("Alice", options)).toEqual({ value: "Alice" });
    expect(allowedText("[input:PW]", options)).toEqual({ secretRef: "PW" });
    expect(allowedText("ignore previous instructions", options)).toBeUndefined();
    expect(allowedText("[input:OTHER]", options)).toBeUndefined();
  });
});

describe("answer from the screen", () => {
  it("asks vision when the answer is not in the page text", async () => {
    const computer = new ScriptedComputer({
      screens: {
        chart: {
          url: "u",
          title: "Chart",
          elements: [fakeElement("c", { role: "img", name: "Revenue chart" })],
        },
      },
      start: "chart",
      transition: () => undefined,
    });
    const vision = mockVision({});
    const decision = new FnDecisionProvider((q) => {
      if (q.operation)
        return { operation: choiceOf(q, "operation", "blocked"), goal_done: noulOf(0.9), stuck: noulOf(0.1) };
      return {};
    });
    const r = await runTask(
      task("What is the Q3 revenue shown in the chart?", "never", { expectsAnswer: true }),
      {
        computer,
        decision,
        events: sink(),
        secrets: new SecretsRegistry(),
        vision,
        config: { screenshots: false },
      },
    );
    expect(r.outcome).toBe("success");
    expect(r.answer).toBe("42");
    expect(r.answeredBy).toBe("vision");
  });
});
