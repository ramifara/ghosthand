// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A stuck run says what Jev wanted to do and what would unblock it; cookie banners are answered by code.
import { TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { consentRejectButton } from "./consent-banner.ts";
import { runTask } from "./loop.ts";
import { SecretsRegistry } from "./secrets.ts";
import { choiceOf, FnDecisionProvider, noulOf } from "./testing/fn-decision-provider.ts";
import { fakeElement, ScriptedComputer } from "./testing/scripted-computer.ts";

const task = (instruction: string) =>
  TaskSpec.parse({
    id: "adhoc",
    instruction,
    startUrl: "http://a.test/",
    plan: {
      source: "task",
      subgoals: [
        { id: "s", goal: instruction, doneWhen: { all: [{ kind: "text", text: "Results for" }], none: [] } },
      ],
    },
  });

const searchBox = fakeElement("e1", {
  role: "textbox",
  name: "Search Maps",
  actions: ["set_value", "press"],
});

const searchScreen = { url: "http://a.test/", title: "Maps", text: "Map", elements: [searchBox] };

/** Jev picks the search box to type into, and the text option when there is one. */
const typeIntoSearch = new FnDecisionProvider((q) => ({
  operation: choiceOf(q, "operation", "set_value"),
  set_value_target: choiceOf(q, "set_value_target", "e1"),
  ...(q.text?.type === "choice"
    ? {
        text: choiceOf(q, "text", Object.keys(q.text.criteria).find((k) => k.startsWith("lit_")) ?? "none"),
      }
    : {}),
  effect: choiceOf(q, "effect", "advance"),
  goal_done: noulOf(0.02),
  stuck: noulOf(0.02),
}));

describe("stuck reasons", () => {
  it("names the field and the missing writer when the goal has no text to type", async () => {
    const computer = new ScriptedComputer({
      screens: { search: searchScreen },
      start: "search",
      transition: () => undefined,
    });
    const r = await runTask(task("find me somewhere nice to eat tonight"), {
      computer,
      decision: typeIntoSearch,
      events: { emit: () => {} },
      secrets: new SecretsRegistry(),
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("stuck");
    expect(r.reason).toContain('type into textbox "Search Maps"');
    expect(r.reason).toContain("goal does not contain the text to type");
    expect(r.reason).toContain("no writer model is set up");
  });

  it("types an unquoted search phrase from the goal", async () => {
    const computer = new ScriptedComputer({
      screens: {
        search: searchScreen,
        results: { url: "http://a.test/r", title: "Maps", text: "Results for vegan", elements: [] },
      },
      start: "search",
      transition: (a) => (a.type === "set_value" ? "results" : undefined),
    });
    const r = await runTask(task("search for a vegan restaurant in berlin"), {
      computer,
      decision: typeIntoSearch,
      events: { emit: () => {} },
      secrets: new SecretsRegistry(),
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(computer.actions).toEqual([
      { type: "set_value", token: "e1", value: "vegan restaurant in berlin" },
    ]);
  });
});

describe("cookie banners", () => {
  const banner = (names: string[], text = "We use cookies and data to deliver our services") => ({
    url: "http://a.test/",
    title: "Example",
    text,
    elements: names.map((name, i) => fakeElement(`b${i}`, { role: "button", name })),
  });
  const snap = (names: string[], text?: string) => {
    const c = new ScriptedComputer({
      screens: { x: banner(names, text) },
      start: "x",
      transition: () => undefined,
    });
    return c.observe().then((r) => {
      if (!r.ok) throw new Error("observe");
      return r.value;
    });
  };

  it("picks the reject choice of a consent banner", async () => {
    expect(consentRejectButton(await snap(["Accept all", "Reject all"]), "search maps")?.name).toBe(
      "Reject all",
    );
    expect(consentRejectButton(await snap(["Alle akzeptieren", "Alle ablehnen"]), "x")?.name).toBe(
      "Alle ablehnen",
    );
  });

  it("leaves pages alone when the goal is about cookies, there is no accept choice, or no consent text", async () => {
    expect(
      consentRejectButton(await snap(["Accept all", "Reject all"]), "accept the cookies"),
    ).toBeUndefined();
    expect(consentRejectButton(await snap(["Decline", "Send"]), "x")).toBeUndefined();
    expect(
      consentRejectButton(await snap(["Accept", "Decline"], "Invitation to the team meeting"), "x"),
    ).toBeUndefined();
  });

  it("answers the banner in code (mode A) and lets Jev continue", async () => {
    const computer = new ScriptedComputer({
      screens: {
        consent: banner(["Accept all", "Reject all"]),
        search: searchScreen,
        results: { url: "http://a.test/r", title: "Maps", text: "Results for vegan", elements: [] },
      },
      start: "consent",
      transition: (a, screen) =>
        screen === "consent" && a.type === "press" && a.token === "b1"
          ? "search"
          : a.type === "set_value"
            ? "results"
            : undefined,
    });
    const r = await runTask(task("search for vegan food"), {
      computer,
      decision: typeIntoSearch,
      events: { emit: () => {} },
      secrets: new SecretsRegistry(),
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("success");
    expect(computer.actions[0]).toEqual({ type: "press", token: "b1" });
    expect(r.modeShares.A).toBeGreaterThan(0);
  });
});
