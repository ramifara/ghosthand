// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Large pages (a search results page with hundreds of links) are cut down to the decision model's limits
// before they are sent, and a `too_large` answer is followed by a smaller re-ask instead of a refusal.
import { type DecisionProvider, type Entry, err, type Questions, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { fitVerifyState, runTask } from "./loop.ts";
import { fitRequest, jevTokens, requestLimits, requestSize } from "./request-fit.ts";
import { SecretsRegistry } from "./secrets.ts";
import { choiceOf, FnDecisionProvider, noulOf } from "./testing/fn-decision-provider.ts";
import { fakeElement, ScriptedComputer } from "./testing/scripted-computer.ts";

const LINKS = 400;
const longName = (i: number) => `Result ${i}: ${"a long search result title with a snippet ".repeat(3)}`;

/** A results page with LINKS long links and a target link at the end of the ranking. */
function resultsPage() {
  const elements = [
    fakeElement("h1", { role: "heading", name: "Results for fat bear" }),
    ...Array.from({ length: LINKS }, (_, i) =>
      fakeElement(`l${i}`, {
        role: "link",
        name: longName(i),
        context: "snippet ".repeat(18),
        href: `https://example.test/${i}`,
      }),
    ),
  ];
  return new ScriptedComputer({
    screens: {
      results: { url: "https://search.test/?q=fat+bear", title: "fat bear", elements },
      article: { url: "https://example.test/0", title: "Fat bear", text: "Feeding time", elements: [] },
    },
    start: "results",
    transition: (a) => (a.type === "press" && a.token === "l0" ? "article" : undefined),
  });
}

const task = TaskSpec.parse({
  id: "adhoc",
  instruction: "open the first result",
  startUrl: "https://search.test/?q=fat+bear",
  plan: {
    source: "task",
    subgoals: [
      {
        id: "s",
        goal: "open the first result",
        doneWhen: { all: [{ kind: "text", text: "Feeding time" }], none: [] },
      },
    ],
  },
});

const pressFirst = (q: Questions) => ({
  operation: choiceOf(q, "operation", "press"),
  press_target: choiceOf(q, "press_target", "l0"),
  effect: choiceOf(q, "effect", "advance"),
  goal_done: noulOf(0.02),
  stuck: noulOf(0.02),
});

/** Jev with the direct API's limits, rejecting requests over `serverLimit` like the real service. */
class LimitedProvider implements DecisionProvider {
  readonly id = "limited";
  readonly capabilities = {
    maxOptions: 255,
    maxLevels: 10,
    contextTokens: 64_000,
    perQuestionContextTokens: 32_000,
    zdr: true,
  };
  readonly sizes: number[] = [];
  readonly #inner = new FnDecisionProvider(pressFirst);
  readonly serverLimit: number;
  constructor(serverLimit: number) {
    this.serverLimit = serverLimit;
  }
  async ask(state: Entry, questions: Questions) {
    const size = requestSize(state, questions).statePlusLongest;
    this.sizes.push(size);
    if (size > this.serverLimit)
      return err({
        kind: "too_large" as const,
        provider: this.id,
        message: '400 {"detail":{"error_type":"max_tokens_exceeded"}}',
      });
    return this.#inner.ask(state, questions);
  }
}

describe("request fitting", () => {
  it("shrinks rounds until the request fits", () => {
    const limits = { total: 1000, statePlusLongest: 600 };
    const r = fitRequest(
      (round) => ({ state: "x".repeat(4000 >> round), questions: { q: { type: "noul" } } }),
      limits,
    );
    // 4000 → 2000 → 1000 characters: 500 tokens plus the question fit 600.
    expect(r.round).toBe(2);
    expect(r.size.statePlusLongest).toBeLessThanOrEqual(600);
  });

  it("cuts a 400-link results page down to the model's limits before sending", async () => {
    const decision = new LimitedProvider(Number.POSITIVE_INFINITY);
    const r = await runTask(task, {
      computer: resultsPage(),
      decision,
      events: { emit: () => {} },
      secrets: new SecretsRegistry(),
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    const limit = requestLimits(decision.capabilities).statePlusLongest;
    for (const s of decision.sizes) expect(s).toBeLessThanOrEqual(limit);
  });

  it("asks again with a smaller page table when the model still answers too_large", async () => {
    // The service is stricter than the documented limits: only about half of them is accepted.
    const decision = new LimitedProvider(14_000);
    const r = await runTask(task, {
      computer: resultsPage(),
      decision,
      events: { emit: () => {} },
      secrets: new SecretsRegistry(),
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(decision.sizes[0]).toBeGreaterThan(14_000);
    expect(decision.sizes.at(-1)).toBeLessThanOrEqual(14_000);
  });

  it("keeps headings and text when the verify state must shrink", () => {
    const all = [
      ...Array.from({ length: 300 }, (_, i) => fakeElement(`l${i}`, { role: "link", name: longName(i) })),
      fakeElement("h1", { role: "heading", name: "Order saved" }),
    ];
    const state = fitVerifyState((elements) => ({ elements: elements.map((e) => e.name) }), all, 2000);
    expect(jevTokens(state)).toBeLessThanOrEqual(2000);
    expect(JSON.stringify(state)).toContain("Order saved");
  });
});
