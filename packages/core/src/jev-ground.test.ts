// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Mode D0 (ADR 0020): Jev locates a described control on the screenshot and the loop clicks it, before
// the LLM vision modes. Tests drive the whole loop with a scripted computer and a function provider.
import { type Box, type Questions, RunEvent, type RunEventDraft, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { D0_ATTEMPTS_PER_SCREEN, isGroundedBox } from "./jev-ground.ts";
import { runTask } from "./loop.ts";
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
    id: "d0",
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
  });

/** Jev finds no listed target: "none" on the press head when there is one, else "blocked" (no heads at all). */
const noTarget = (q: Questions) => ({
  operation: choiceOf(q, "operation", q.press_target ? "press" : "blocked"),
  ...(q.press_target ? { press_target: choiceOf(q, "press_target", "none") } : {}),
  effect: choiceOf(q, "effect", "advance"),
  goal_done: noulOf(0.1),
  stuck: noulOf(0.05),
});

const boxAnswer = (box: Box, confidence = 0.9) => ({ type: "box" as const, box, confidence });

/** A canvas page: one unrelated button, the real target is only paint. */
const canvasScreens: Record<string, ScriptedScreen> = {
  canvas: {
    url: "u",
    title: "Chart",
    elements: [
      fakeElement("e1", {
        role: "button",
        name: "Help",
        actions: ["press"],
        bounds: { x: 1100, y: 10, width: 80, height: 30 },
        visibleBounds: { x: 1100, y: 10, width: 80, height: 30 },
      }),
    ],
  },
  done: { url: "u", title: "Chart", text: "Q3 selected", elements: [] },
};
const canvasComputer = () =>
  new ScriptedComputer({
    screens: canvasScreens,
    start: "canvas",
    transition: (a) => (a.type === "click" && "captureId" in a.target ? "done" : undefined),
  });

/** Answers act questions with "none" and ground questions with the given box and presence. */
type Ground = { present: number; box: Box; confidence?: number };
function provider(ground: Ground | Ground[]) {
  const grounds: Ground[] = Array.isArray(ground) ? [...ground] : [ground];
  const p = new FnDecisionProvider((q) => {
    if (q.operation) return noTarget(q);
    if (q.where?.type === "box") {
      const g = grounds.length > 1 ? grounds.shift() : grounds[0];
      if (!g) return {};
      return {
        present: noulOf(g.present),
        where: boxAnswer(g.box, g.confidence ?? 0.9),
        effect: choiceOf(q, "effect", "advance"),
      };
    }
    return {};
  });
  return p;
}

const deps = (computer: ScriptedComputer, decision: FnDecisionProvider, events = sink()) => ({
  computer,
  decision,
  events,
  secrets: new SecretsRegistry(),
  config: { screenshots: false },
});

describe("isGroundedBox", () => {
  const capture = { id: "c1", width: 1280, height: 860, scale: 1 };
  const gates = { boxPresent: 0.7, boxMaxArea: 0.25 };
  const button = fakeElement("e1", {
    role: "button",
    name: "Save",
    actions: ["press"],
    bounds: { x: 600, y: 400, width: 100, height: 40 },
    visibleBounds: { x: 600, y: 400, width: 100, height: 40 },
  });

  it("accepts a box whose centre lies inside an element", () => {
    const r = isGroundedBox(
      { top: 0.46, bottom: 0.52, left: 0.46, right: 0.55 },
      0.95,
      [button],
      capture,
      gates,
    );
    expect(r).toEqual({ grounded: true, matchedToken: "e1" });
  });

  it("accepts a box that touches no element (canvas paint)", () => {
    const r = isGroundedBox({ top: 0.1, bottom: 0.2, left: 0.1, right: 0.2 }, 0.95, [button], capture, gates);
    expect(r).toEqual({ grounded: true });
  });

  it("rejects an absent target, an oversized box and a box that overlaps an element without covering its centre", () => {
    const box = { top: 0.46, bottom: 0.52, left: 0.46, right: 0.55 };
    expect(isGroundedBox(box, 0.2, [button], capture, gates).grounded).toBe(false);
    expect(
      isGroundedBox({ top: 0, bottom: 0.8, left: 0, right: 0.8 }, 0.99, [button], capture, gates).grounded,
    ).toBe(false);
    // Overlaps the button's left edge; its centre (x=576) is left of the button.
    expect(
      isGroundedBox({ top: 0.46, bottom: 0.52, left: 0.42, right: 0.48 }, 0.95, [button], capture, gates),
    ).toEqual({ grounded: false, reason: expect.stringMatching(/overlap/) });
  });
});

describe("mode D0: Jev box grounding", () => {
  it("clicks the centre of a grounded box after Jev finds no listed target twice, with no LLM vision", async () => {
    const computer = canvasComputer();
    const decision = provider({ present: 0.98, box: { top: 0.4, bottom: 0.5, left: 0.3, right: 0.38 } });
    const s = sink();
    const r = await runTask(
      task("Select the Q3 bar in the chart", "Q3 selected"),
      deps(computer, decision, s),
    );
    expect(r.outcome).toBe("success");
    expect(r.modelCalls).toBe(0);
    expect(computer.actions.at(-1)).toEqual({
      type: "click",
      target: { captureId: expect.any(String), x: Math.round(0.34 * 1280), y: Math.round(0.45 * 860) },
    });
    expect(r.modeShares.D0).toBeCloseTo(1 / 2);
    const ground = s.events.find((e) => e.type === "decision.request" && e.purpose === "ground");
    expect(ground?.type === "decision.request" && ground.images?.[0]).toMatchObject({
      ref: "<image:screen>",
      mimeType: "image/jpeg",
      width: 1280,
      height: 860,
      tokens: expect.any(Number),
    });
    expect(ground?.type === "decision.request" && ground.model).toBeUndefined();
    const action = s.events.find((e) => e.type === "action" && e.mode === "D0");
    expect(action?.type === "action" && action.target?.box).toEqual({
      top: 0.4,
      bottom: 0.5,
      left: 0.3,
      right: 0.38,
    });
    expect(s.events.some((e) => e.type === "escalate" && e.to === "D0")).toBe(true);
    // The request carried the image under the ref the state uses.
    const req = decision.requests.find((q) => q.questions.where?.type === "box");
    expect(req?.images[0]?.ref).toBe("<image:screen>");
    expect(JSON.stringify(req?.state)).toContain("<image:screen>");
    expect(JSON.stringify(req?.questions)).toContain("evidence");
  });

  it("does not click when the presence noul says the target is absent", async () => {
    const computer = canvasComputer();
    const decision = provider({ present: 0.01, box: { top: 0.4, bottom: 0.5, left: 0.3, right: 0.38 } });
    const s = sink();
    const r = await runTask(
      task("Select the Q3 bar in the chart", "Q3 selected"),
      deps(computer, decision, s),
    );
    expect(r.outcome).not.toBe("success");
    expect(computer.actions.some((a) => a.type === "click" && "captureId" in a.target)).toBe(false);
    expect(s.events.some((e) => e.type === "action" && e.mode === "D0")).toBe(false);
  });

  it("rejects a box covering most of the screen", async () => {
    const computer = canvasComputer();
    const decision = provider({ present: 0.99, box: { top: 0.05, bottom: 0.9, left: 0.05, right: 0.9 } });
    const r = await runTask(task("Select the Q3 bar in the chart", "Q3 selected"), deps(computer, decision));
    expect(r.outcome).not.toBe("success");
    expect(computer.actions.some((a) => a.type === "click" && "captureId" in a.target)).toBe(false);
  });

  it("zooms into the region once when the box overlaps an element without covering its centre", async () => {
    const screens: Record<string, ScriptedScreen> = {
      page: {
        url: "u",
        title: "Editor",
        elements: [
          fakeElement("e1", {
            role: "button",
            name: "",
            actions: ["press"],
            bounds: { x: 640, y: 440, width: 100, height: 30 },
            visibleBounds: { x: 640, y: 440, width: 100, height: 30 },
          }),
        ],
      },
      done: { url: "u", title: "Editor", text: "bold applied", elements: [] },
    };
    const computer = new ScriptedComputer({
      screens,
      start: "page",
      transition: (a) => (a.type === "click" && "captureId" in a.target ? "done" : undefined),
    });
    // First box: x 0.4–0.6 (512–768), y 0.45–0.55 (387–473): overlaps the button, centre (640, 430) above it.
    // Second box (on the region): centre lands inside the button.
    const decision = provider([
      { present: 0.95, box: { top: 0.45, bottom: 0.55, left: 0.4, right: 0.6 } },
      { present: 0.95, box: { top: 0.5, bottom: 0.7, left: 0.45, right: 0.6 } },
    ]);
    const s = sink();
    const r = await runTask(task("Make the selection bold", "bold applied"), deps(computer, decision, s));
    expect(r.outcome).toBe("success");
    const grounds = s.events.filter((e) => e.type === "decision.request" && e.purpose === "ground");
    expect(grounds).toHaveLength(2);
    expect(grounds[1]?.type === "decision.request" && grounds[1].images?.[0]?.ref).toBe("<image:region>");
    const region = computer.captureRegions.at(-1);
    expect(region).toBeDefined();
    expect(region?.width).toBeGreaterThanOrEqual(280);
    expect(region?.height).toBeGreaterThanOrEqual(280);
    const click = computer.actions.at(-1);
    expect(click?.type === "click" && "captureId" in click.target && click.target.captureId).toBe(
      `c${computer.screenshots}`,
    );
  });

  it("gives D0 at most two attempts per screen, then the ladder continues", async () => {
    const computer = new ScriptedComputer({
      screens: canvasScreens,
      start: "canvas",
      transition: () => undefined,
    });
    const decision = provider({ present: 0.01, box: { top: 0.4, bottom: 0.5, left: 0.3, right: 0.38 } });
    const s = sink();
    await runTask(task("Select the Q3 bar in the chart", "Q3 selected"), deps(computer, decision, s));
    const escalations = s.events.filter((e) => e.type === "escalate" && e.to === "D0");
    expect(escalations).toHaveLength(D0_ATTEMPTS_PER_SCREEN);
  });

  it("does nothing when images are off", async () => {
    const computer = canvasComputer();
    const decision = provider({ present: 0.98, box: { top: 0.4, bottom: 0.5, left: 0.3, right: 0.38 } });
    const s = sink();
    const r = await runTask(task("Select the Q3 bar in the chart", "Q3 selected"), {
      ...deps(computer, decision, s),
      config: { screenshots: false, images: "off" },
    });
    expect(r.outcome).not.toBe("success");
    expect(s.events.some((e) => e.type === "escalate" && e.to === "D0")).toBe(false);
    expect(decision.requests.every((q) => q.images.length === 0)).toBe(true);
  });
});

describe("D0 captures in the run folder", () => {
  it("writes what Jev saw as a labelled capture and records the file on the request", async () => {
    const computer = canvasComputer();
    const decision = provider({ present: 0.98, box: { top: 0.4, bottom: 0.5, left: 0.3, right: 0.38 } });
    const written: Array<{ step: number; bytes: number; label?: string }> = [];
    const s = sink();
    const events = {
      emit: s.emit,
      writeScreenshot: (step: number, bytes: Uint8Array, label?: string) => {
        written.push({ step, bytes: bytes.byteLength, ...(label ? { label } : {}) });
        return `step-${String(step).padStart(3, "0")}${label ? `-${label}` : ""}.jpg`;
      },
    };
    const r = await runTask(task("Select the Q3 bar in the chart", "Q3 selected"), {
      ...deps(computer, decision, s),
      events,
    });
    expect(r.outcome).toBe("success");
    expect(written.some((w) => w.label === "d0")).toBe(true);
    const ground = s.events.find((e) => e.type === "decision.request" && e.purpose === "ground");
    expect(ground?.type === "decision.request" && ground.images?.[0]?.file).toMatch(/^step-\d{3}-d0\.jpg$/);
  });
});

describe("D0 on a text field", () => {
  const screens: Record<string, ScriptedScreen> = {
    promo: { url: "u", title: "Promo", elements: [] },
    typed: { url: "u", title: "Promo", text: "Code typed", elements: [] },
    done: { url: "u", title: "Promo", text: "Promo code ABC-1 applied.", elements: [] },
  };
  /** Clicks focus; typing moves on; a later click applies. */
  const computer = () =>
    new ScriptedComputer({
      screens,
      start: "promo",
      transition: function (this: ScriptedComputer | undefined, a) {
        if (a.type === "type_text") return "typed";
        return undefined;
      },
    });

  it("types the goal's only literal after clicking a located text field, then keeps going", async () => {
    const c = computer();
    let grounds = 0;
    const decision = new FnDecisionProvider((q) => {
      if (q.operation) return noTarget(q);
      if (q.where?.type === "box") {
        grounds++;
        const textKey =
          q.text?.type === "choice"
            ? (Object.entries(q.text.criteria).find(([, d]) => String(d).includes("ABC-1"))?.[0] ?? "none")
            : "none";
        return {
          present: noulOf(0.97),
          where: boxAnswer({ top: 0.2, bottom: 0.26, left: 0.12, right: 0.32 }),
          effect: choiceOf(q, "effect", "advance"),
          kind: choiceOf(q, "kind", grounds === 1 ? "text_field" : "button"),
          ...(q.text ? { text: choiceOf(q, "text", textKey) } : {}),
        };
      }
      return {};
    });
    const s = sink();
    await runTask(
      task('Enter the promo code "ABC-1" in the promo box and apply it', "Promo code ABC-1 applied."),
      deps(c, decision, s),
    );
    const typed = c.actions.find((a) => a.type === "type_text");
    expect(typed).toEqual({ type: "type_text", text: "ABC-1" });
    const typedEvent = s.events.find((e) => e.type === "action" && e.action.type === "type_text");
    expect(typedEvent?.type === "action" && typedEvent.mode).toBe("D0");
    // The second D0 look describes what happened so far, so Jev can aim at the next control.
    const second = decision.requests.filter((r) => r.questions.where?.type === "box")[1];
    const target = (second?.state as { task?: { target?: string } } | undefined)?.task?.target ?? "";
    expect(target).toContain('typed "ABC-1"');
  });

  it("does not type when the located control is a button", async () => {
    const c = computer();
    const decision = provider({ present: 0.97, box: { top: 0.2, bottom: 0.26, left: 0.12, right: 0.32 } });
    await runTask(
      task('Enter the promo code "ABC-1" in the promo box and apply it', "Promo code ABC-1 applied."),
      deps(c, decision),
    );
    expect(c.actions.some((a) => a.type === "type_text")).toBe(false);
  });
});
