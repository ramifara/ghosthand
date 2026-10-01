// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DesktopTestbedState } from "./desktop-tasks.ts";
import { DESKTOP_TASKS, desktopTaskSpec, getDesktopTask, gradeDesktopTask } from "./desktop-tasks.ts";

const state = (over: Partial<DesktopTestbedState>): DesktopTestbedState => ({
  version: 1,
  profile: null,
  items: ["Eggs", "Bread", "Coffee"],
  events: [],
  ...over,
});

const task = (id: string) => {
  const t = getDesktopTask(id);
  if (!t) throw new Error(id);
  return t;
};

describe("desktop tasks", () => {
  it("builds task specs with one commit-allowed subgoal", () => {
    for (const t of DESKTOP_TASKS) {
      const spec = desktopTaskSpec(t);
      expect(spec.startUrl).toBe("desktop:app");
      expect(spec.plan?.subgoals[0]?.allowedEffects).toEqual(["advance", "commit"]);
    }
  });

  it("oracles pass only on the right state", () => {
    const profile = task("desktop-profile");
    expect(profile.oracle(state({})).pass).toBe(false);
    expect(
      profile.oracle(
        state({
          profile: { name: "Ada Lovelace", email: "ada@example.com", plan: "Free", newsletter: false },
        }),
      ).pass,
    ).toBe(true);
    const plan = task("desktop-plan");
    expect(
      plan.oracle(
        state({
          profile: { name: "Grace Hopper", email: "grace@example.com", plan: "Pro", newsletter: false },
        }),
      ).pass,
    ).toBe(false);
    expect(
      plan.oracle(
        state({
          profile: { name: "Grace Hopper", email: "grace@example.com", plan: "Pro", newsletter: true },
        }),
      ).pass,
    ).toBe(true);
    const list = task("desktop-list");
    expect(list.oracle(state({ items: ["Eggs", "Coffee", "Milk"] })).pass).toBe(true);
    expect(list.oracle(state({ items: ["Coffee", "Milk"] })).pass).toBe(false);
    expect(list.oracle(state({ items: ["Eggs", "Bread", "Coffee", "Milk"] })).pass).toBe(false);
  });

  it("grades from the state file and fails closed when it is missing or malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-desktop-task-"));
    try {
      expect(gradeDesktopTask(task("desktop-list"), dir)).toMatchObject({ pass: false });
      writeFileSync(join(dir, "state.json"), "{}");
      expect(gradeDesktopTask(task("desktop-list"), dir).detail).toMatch(/invalid/);
      writeFileSync(join(dir, "state.json"), JSON.stringify(state({ items: ["Eggs", "Coffee", "Milk"] })));
      expect(gradeDesktopTask(task("desktop-list"), dir).pass).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
