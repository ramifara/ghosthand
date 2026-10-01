// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isDesktopTask, prepareDesktopRun } from "./desktop-launcher.ts";

describe("desktop task runs", () => {
  it("knows its tasks and rejects others", () => {
    expect(isDesktopTask("desktop-list")).toBe(true);
    expect(isDesktopTask("l1-login")).toBe(false);
    const bad = prepareDesktopRun("desktop-nope");
    expect(bad.ok).toBe(false);
  });

  it("grades from the sandbox folder it is told about", async () => {
    const r = prepareDesktopRun("desktop-list");
    if (!r.ok) throw new Error(r.error.message);
    const p = r.value;
    expect(p.spec.plan?.subgoals.map((g) => g.id)).toEqual(["desktop-list-add", "desktop-list-remove"]);
    expect(p.launch.testbedSeed).toBe("default");
    expect(await p.oracle("desktop-list")).toBeUndefined();
    const dir = mkdtempSync(join(tmpdir(), "gh-engine-desktop-"));
    try {
      writeFileSync(
        join(dir, "state.json"),
        JSON.stringify({ version: 1, profile: null, items: ["Eggs", "Coffee", "Milk"], events: [] }),
      );
      p.launch.onWorkDir?.(dir);
      expect(await p.oracle("desktop-list")).toBe(true);
      expect(p.lastVerdict()).toBe("items: Eggs, Coffee, Milk");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
