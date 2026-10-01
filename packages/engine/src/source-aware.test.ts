// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { fileURLToPath } from "node:url";
import { extractSourceMap } from "@ghosthand/knowledge";
import { type Snapshot, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { routeForGoal, sourceAwareExtras } from "./source-aware.ts";

const WEB_SRC = fileURLToPath(new URL("../../../apps/testbed/web/src", import.meta.url));

const at = (url: string): Snapshot => ({
  id: "s",
  surface: "web",
  takenAt: 0,
  url,
  title: "",
  viewport: { x: 0, y: 0, width: 1, height: 1 },
  elements: [],
  text: "",
  tokenEstimate: 1,
  quality: { elementCount: 0, unnamedInteractive: 0, score: 1 },
  narrowed: false,
});

describe("source-aware mode on the testbed web app", async () => {
  const map = await extractSourceMap(WEB_SRC);
  if (!map.ok) throw new Error(map.error.kind);

  it("finds the route a goal names", () => {
    expect(routeForGoal(map.value, "In Settings, open the Notifications tab and save")?.path).toBe(
      "/settings",
    );
    expect(routeForGoal(map.value, "In Orders, sort the table by amount")?.path).toBe("/orders");
    expect(routeForGoal(map.value, "Sign in as alice")).toBeUndefined();
  });

  it("navigates first only from the home page, to the same origin", () => {
    const task = TaskSpec.parse({
      id: "adhoc",
      instruction: "In Settings, open the Notifications tab and save",
      startUrl: "http://127.0.0.1:4400/",
    });
    const extras = sourceAwareExtras(map.value, task);
    expect(extras.navigateFirst(task, at("http://127.0.0.1:4400/"))).toBe("http://127.0.0.1:4400/settings");
    expect(extras.navigateFirst(task, at("http://127.0.0.1:4400/profile"))).toBeUndefined();
    expect(extras.plannerContext).toContain("/settings");
  });

  it("seeds names from the current route", () => {
    const task = TaskSpec.parse({ id: "adhoc", instruction: "x", startUrl: "http://127.0.0.1:4400/login" });
    const seeds = sourceAwareExtras(map.value, task).seedTargets?.(
      {
        id: "s",
        goal: "Type the password and sign in",
        doneWhen: { all: [], none: [] },
        allowedEffects: ["advance"],
        maxSteps: 5,
        seedTargets: [],
      },
      at("http://127.0.0.1:4400/login"),
    );
    expect(seeds).toContain("Password");
  });
});
