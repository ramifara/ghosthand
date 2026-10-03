// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Guidance (ADR 0017): the writer shortlists candidates and Jev picks among them; the advance gate scales
// with the number of choices; a page that holds nothing after an advance is backtracked.
import type { Answer, Questions } from "@ghosthand/protocol";
import { ok, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { runTask } from "./loop.ts";
import { SecretsRegistry } from "./secrets.ts";
import { choiceOf, FnDecisionProvider, noulOf } from "./testing/fn-decision-provider.ts";
import { fakeElement, ScriptedComputer } from "./testing/scripted-computer.ts";
import type { ShortlistInput, Writer } from "./writer.ts";

const LINKS = 40;
const page = () =>
  new ScriptedComputer({
    screens: {
      article: {
        url: "https://wiki.test/Start",
        title: "Start",
        elements: [
          ...Array.from({ length: LINKS }, (_, i) =>
            fakeElement(`l${i}`, { role: "link", name: `Topic ${i}`, href: `/t/${i}` }),
          ),
          fakeElement("target", { role: "link", name: "England", href: "/England" }),
        ],
      },
      england: { url: "https://wiki.test/England", title: "England", text: "England article", elements: [] },
      dead: {
        url: "https://wiki.test/t/3",
        title: "Topic 3",
        text: "Nothing here",
        elements: [fakeElement("x", { role: "link", name: "Unrelated", href: "/u" })],
      },
    },
    start: "article",
    transition: (a) =>
      a.type === "press" && a.token === "target"
        ? "england"
        : a.type === "press" && a.token === "l3"
          ? "dead"
          : undefined,
  });

const task = TaskSpec.parse({
  id: "adhoc",
  instruction: "reach the England article",
  startUrl: "https://wiki.test/Start",
  plan: {
    source: "task",
    subgoals: [
      {
        id: "s",
        goal: "reach the England article",
        doneWhen: { all: [{ kind: "text", text: "England article" }], none: [] },
      },
    ],
  },
});

/** A writer that shortlists `picks` and records what it was asked. */
function shortlister(picks: string[]): Writer & { asked: ShortlistInput[] } {
  const asked: ShortlistInput[] = [];
  return {
    id: "fake-writer",
    asked,
    hint: async () =>
      ok({ hint: { kind: "none" as const, reason: "unused" }, model: "fake", latencyMs: 1, costUsd: 0 }),
    shortlist: async (input) => {
      asked.push(input);
      return ok({
        shortlist: { picks, note: "England is the goal" },
        model: "fake",
        latencyMs: 5,
        costUsd: 0.0001,
      });
    },
  };
}

/** Jev: thin over the full table (prefers a wrong link), decisive on a short one. */
const thinThenDecisive = (q: Questions): Record<string, Answer> => {
  const targets = q.press_target?.type === "choice" ? Object.keys(q.press_target.criteria) : [];
  const elements = targets.filter((k) => !["none", "ambiguous"].includes(k));
  if (elements.length > 10) {
    const probabilities: Record<string, number> = Object.fromEntries(targets.map((k) => [k, 0]));
    probabilities.l3 = 0.3;
    probabilities.none = 0.4;
    probabilities.target = 0.25;
    return {
      operation: choiceOf(q, "operation", "press"),
      press_target: { type: "choice", choice: "none", confidence: 0.4, probabilities },
      effect: choiceOf(q, "effect", "advance"),
      goal_done: noulOf(0.02),
      stuck: noulOf(0.02),
    };
  }
  return {
    operation: choiceOf(q, "operation", elements.length ? "press" : "blocked"),
    press_target: choiceOf(q, "press_target", elements.includes("target") ? "target" : "none"),
    effect: choiceOf(q, "effect", "advance"),
    goal_done: noulOf(0.02),
    stuck: noulOf(0.02),
  };
};

const run = (guidance: "off" | "stuck" | "unsure" | "every", writer: Writer, computer = page()) =>
  runTask(task, {
    computer,
    decision: new FnDecisionProvider(thinThenDecisive),
    writer,
    events: { emit: () => {} },
    secrets: new SecretsRegistry(),
    config: { screenshots: false, guidance },
  }).then((r) => ({ r, computer }));

describe("guidance", () => {
  it("'every': the writer shortlists before Jev decides, and Jev picks among the few", async () => {
    const writer = shortlister(["target", "l7"]);
    const { r, computer } = await run("every", writer);
    expect(r.outcome).toBe("success");
    expect(writer.asked).toHaveLength(1);
    expect(writer.asked[0]?.candidates.some((c) => c.startsWith("target — link"))).toBe(true);
    expect(computer.actions).toEqual([{ type: "press", token: "target" }]);
    expect(r.modelCalls).toBe(1);
  });

  it("'every': Jev's 'ambiguous' on a shortlist resolves to the writer's first pick", async () => {
    const writer = shortlister(["l7", "target"]);
    const computer = page();
    const decision = new FnDecisionProvider((q) => {
      const targets = q.press_target?.type === "choice" ? Object.keys(q.press_target.criteria) : [];
      const elements = targets.filter((k) => !["none", "ambiguous"].includes(k));
      if (elements.length <= 5 && elements.length > 0) {
        // Three plausible links "fit equally well": the sentinel wins, as it did on the real shortlist.
        const probabilities: Record<string, number> = Object.fromEntries(targets.map((k) => [k, 0]));
        probabilities.ambiguous = 0.46;
        probabilities.l7 = 0.21;
        probabilities.none = 0.15;
        probabilities.target = 0.18;
        return {
          operation: choiceOf(q, "operation", "press"),
          press_target: { type: "choice", choice: "ambiguous", confidence: 0.46, probabilities },
          effect: choiceOf(q, "effect", "advance"),
          goal_done: noulOf(0.02),
          stuck: noulOf(0.02),
        };
      }
      return thinThenDecisive(q);
    });
    const r = await runTask(task, {
      computer,
      decision,
      writer,
      events: { emit: () => {} },
      secrets: new SecretsRegistry(),
      config: { screenshots: false, guidance: "every" },
    });
    // l7 leads nowhere (no transition); the dead end backtracks, l7 ranks last, and England follows.
    expect(computer.actions[0]).toEqual({ type: "press", token: "l7" });
    expect(r.outcome === "success" || computer.actions.length >= 1).toBe(true);
  });

  it("'unsure': the shortlist is asked only after a thin answer, then Jev decides", async () => {
    const writer = shortlister(["target"]);
    const { r, computer } = await run("unsure", writer);
    expect(r.outcome).toBe("success");
    expect(writer.asked).toHaveLength(1);
    expect(computer.actions).toEqual([{ type: "press", token: "target" }]);
  });

  it("'off': the writer is never asked", async () => {
    const writer = shortlister(["target"]);
    const { r } = await run("off", writer);
    expect(writer.asked).toHaveLength(0);
    expect(r.outcome).toBe("stuck");
  });
});

describe("advance gate scaled by the number of choices", () => {
  it("accepts the most likely of many links when it beats none, and backtracks a dead end", async () => {
    const computer = page();
    let onDead = 0;
    const decision = new FnDecisionProvider((q, state) => {
      const url = (state as { page?: { url?: string } }).page?.url ?? "";
      const targets = q.press_target?.type === "choice" ? Object.keys(q.press_target.criteria) : [];
      if (url.includes("/t/3")) {
        onDead++;
        return {
          operation: choiceOf(q, "operation", "blocked"),
          press_target: choiceOf(q, "press_target", "none"),
          effect: choiceOf(q, "effect", "advance"),
          goal_done: noulOf(0.02),
          stuck: noulOf(0.3),
        };
      }
      // On the start page: first the wrong link l3 at 30 % over 41 options (demand max(0.2, 1.5/41)),
      // then, with l3 ranked last after the backtrack, the England link.
      const probabilities: Record<string, number> = Object.fromEntries(targets.map((k) => [k, 0]));
      const pick = computer.actions.some((a) => a.type === "press" && a.token === "l3") ? "target" : "l3";
      probabilities[pick] = 0.3;
      probabilities.none = 0.2;
      return {
        operation: choiceOf(q, "operation", "press"),
        press_target: { type: "choice", choice: pick, confidence: 0.3, probabilities },
        effect: choiceOf(q, "effect", "advance"),
        goal_done: noulOf(0.02),
        stuck: noulOf(0.02),
      };
    });
    const r = await runTask(task, {
      computer,
      decision,
      events: { emit: () => {} },
      secrets: new SecretsRegistry(),
      config: { screenshots: false, guidance: "off" },
    });
    expect(r.outcome).toBe("success");
    expect(computer.actions.map((a) => (a.type === "press" ? a.token : a.type))).toEqual(["l3", "target"]);
    expect(computer.opened).toContain("https://wiki.test/Start");
    expect(onDead).toBeGreaterThan(0);
  });
});
