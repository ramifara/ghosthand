// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Large pages (ADR 0016): a narrowed region where Jev finds nothing is left for the whole page in the
// same step and not offered again; an advance action with a clear favourite runs on a thin answer.
import type { Answer, ComputerError, ObserveScope, Result, Snapshot } from "@ghosthand/protocol";
import { TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { runTask } from "./loop.ts";
import { SecretsRegistry } from "./secrets.ts";
import { choiceOf, FnDecisionProvider, noulOf } from "./testing/fn-decision-provider.ts";
import { fakeElement, ScriptedComputer } from "./testing/scripted-computer.ts";

const LINKS = 400;
const name = (i: number) => `Topic ${i}: ${"a long article link title ".repeat(3)}`;

/** A page with two regions: a big "Economy" section and a smaller "Agriculture" section with the target. */
class RegionsComputer extends ScriptedComputer {
  readonly scopes: Array<string | undefined> = [];
  override async observe(scope?: ObserveScope): Promise<Result<Snapshot, ComputerError>> {
    this.scopes.push(scope?.region);
    const r = await super.observe();
    if (!r.ok) return r;
    const snap = r.value;
    const economy = snap.elements.filter((e) => e.context === "Economy");
    const agriculture = snap.elements.filter((e) => e.context === "Agriculture");
    const regions: NonNullable<Snapshot["regions"]> = [
      { id: "section-economy", kind: "section", label: "Economy", elementCount: economy.length },
      { id: "section-agriculture", kind: "section", label: "Agriculture", elementCount: agriculture.length },
    ];
    if (scope?.region === "section-economy")
      return {
        ok: true,
        value: { ...snap, elements: economy, regions, scope: "section-economy", narrowed: true },
      };
    if (scope?.region === "section-agriculture")
      return {
        ok: true,
        value: { ...snap, elements: agriculture, regions, scope: "section-agriculture", narrowed: true },
      };
    return { ok: true, value: { ...snap, regions, pageTokenEstimate: 60_000 } };
  }
}

const page = () =>
  new RegionsComputer({
    screens: {
      article: {
        url: "https://wiki.test/South_Dakota",
        title: "South Dakota",
        elements: [
          ...Array.from({ length: LINKS }, (_, i) =>
            fakeElement(`l${i}`, { role: "link", name: name(i), context: "Economy", href: `/t/${i}` }),
          ),
          fakeElement("agri", {
            role: "link",
            name: "Agriculture in South Dakota",
            context: "Agriculture",
            href: "/agri",
          }),
        ],
      },
      agri: {
        url: "https://wiki.test/Agriculture",
        title: "Agriculture",
        text: "Agriculture article",
        elements: [],
      },
    },
    start: "article",
    transition: (a) => (a.type === "press" && a.token === "agri" ? "agri" : undefined),
  });

const task = TaskSpec.parse({
  id: "adhoc",
  instruction: 'open the link "Agriculture in South Dakota"',
  startUrl: "https://wiki.test/South_Dakota",
  plan: {
    source: "task",
    subgoals: [
      {
        id: "s",
        goal: 'open the link "Agriculture in South Dakota"',
        doneWhen: { all: [{ kind: "text", text: "Agriculture article" }], none: [] },
      },
    ],
  },
});

describe("narrowing dead ends", () => {
  it("re-asks on the whole page when the chosen region holds nothing, and remembers the region", async () => {
    const computer = page();
    let narrowAsks = 0;
    const decision = new FnDecisionProvider((q) => {
      if (q.region) {
        narrowAsks++;
        // Jev keeps picking the Economy section (it matches the page's biggest region).
        return { region: choiceOf(q, "region", "section-economy") };
      }
      const hasAgri = Object.keys(q.press_target?.type === "choice" ? q.press_target.criteria : {}).includes(
        "agri",
      );
      return {
        operation: choiceOf(q, "operation", hasAgri ? "press" : "blocked"),
        press_target: choiceOf(q, "press_target", hasAgri ? "agri" : "none"),
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
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(narrowAsks).toBe(1);
    expect(computer.actions).toEqual([{ type: "press", token: "agri" }]);
  });
});

describe("advance margin gate", () => {
  it("presses a link whose target clearly beats every other element, even under 0.7", async () => {
    const computer = new ScriptedComputer({
      screens: {
        a: {
          url: "https://wiki.test/a",
          title: "a",
          elements: [
            fakeElement("l1", { role: "link", name: "Economy", href: "/e" }),
            fakeElement("l2", { role: "link", name: "History", href: "/h" }),
            fakeElement("l3", { role: "link", name: "Geography", href: "/g" }),
          ],
        },
        e: { url: "https://wiki.test/e", title: "Economy", text: "Economy article", elements: [] },
      },
      start: "a",
      transition: (a) => (a.type === "press" && a.token === "l1" ? "e" : undefined),
    });
    const thin: Answer = {
      type: "choice",
      choice: "l1",
      confidence: 0.52,
      probabilities: { l1: 0.52, none: 0.41, l2: 0.04, l3: 0.03 },
    };
    const decision = new FnDecisionProvider((q) => ({
      operation: choiceOf(q, "operation", "press"),
      press_target: thin,
      effect: choiceOf(q, "effect", "advance"),
      goal_done: noulOf(0.02),
      stuck: noulOf(0.02),
    }));
    const t = TaskSpec.parse({
      id: "adhoc",
      instruction: "open the economy article",
      startUrl: "https://wiki.test/a",
      plan: {
        source: "task",
        subgoals: [
          {
            id: "s",
            goal: "open the economy article",
            doneWhen: { all: [{ kind: "text", text: "Economy article" }], none: [] },
          },
        ],
      },
    });
    const r = await runTask(t, {
      computer,
      decision,
      events: { emit: () => {} },
      secrets: new SecretsRegistry(),
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(computer.actions).toEqual([{ type: "press", token: "l1" }]);
  });
});
