// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Source-aware route-first navigation: the page's own link when there is one, else a direct navigation.
import { TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { runTask } from "./loop.ts";
import { SecretsRegistry } from "./secrets.ts";
import { FnDecisionProvider } from "./testing/fn-decision-provider.ts";
import { fakeElement, ScriptedComputer } from "./testing/scripted-computer.ts";

const task = TaskSpec.parse({
  id: "x",
  instruction: "In Settings, save",
  startUrl: "http://a.test/",
  plan: {
    source: "task",
    subgoals: [
      { id: "s", goal: "g", doneWhen: { all: [{ kind: "text", text: "Settings page" }], none: [] } },
    ],
  },
});

const run = (withLink: boolean) => {
  const computer = new ScriptedComputer({
    screens: {
      home: {
        url: "http://a.test/",
        title: "Home",
        elements: withLink
          ? [fakeElement("l1", { role: "link", name: "Settings", href: "/settings", actions: ["press"] })]
          : [],
      },
      settings: { url: "http://a.test/settings", title: "Settings", text: "Settings page", elements: [] },
    },
    start: "home",
    transition: (a) => (a.type === "press" && a.token === "l1" ? "settings" : undefined),
  });
  return runTask(task, {
    computer,
    decision: new FnDecisionProvider(() => ({})),
    events: { emit: () => {} },
    secrets: new SecretsRegistry(),
    navigateFirst: () => "http://a.test/settings",
    config: { screenshots: false },
  }).then((r) => ({ r, computer }));
};

describe("navigateFirst", () => {
  it("presses the page's own link to the route (mode A, no model call)", async () => {
    const { r, computer } = await run(true);
    expect(r.outcome).toBe("success");
    expect(r.decisionCalls).toBe(0);
    expect(r.modeShares).toEqual({ A: 1 });
    expect(computer.actions).toEqual([{ type: "press", token: "l1" }]);
  });

  it("opens the URL when the page has no link to it", async () => {
    const { computer } = await run(false);
    expect(computer.opened).toEqual(["http://a.test/", "http://a.test/settings"]);
  });
});
