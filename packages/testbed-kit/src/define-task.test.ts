// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { verdict } from "./control-schemas.ts";
import { defineTask, type TaskDefinitionInput } from "./define-task.ts";
import { getTask, listTaskIds, tasks } from "./registry.ts";
import { toTaskSpec } from "./task-spec.ts";

const base: TaskDefinitionInput = {
  id: "l1-example",
  version: 1,
  level: 1,
  setup: { seed: 1 },
  start: "/",
  instruction: "Sign in with [input:TESTBED_PASSWORD].",
  oracle: () => verdict({ ok: true }),
  forbidden: [],
  secrets: ["TESTBED_PASSWORD"],
};

describe("defineTask", () => {
  it("fills defaults for variant, seeds, budget and doneWhen", () => {
    const task = defineTask(base);
    expect(task.setup.variant).toEqual({ testids: "off", a11y: "good" });
    expect(task.setup.seeds).toEqual([]);
    expect(task.budget).toEqual({ steps: 60, seconds: 600, usd: 0.5 });
    expect(task.doneWhen).toEqual({ all: [{ kind: "oracle", taskId: "l1-example" }], none: [] });
    expect(Object.isFrozen(task)).toBe(true);
  });

  it("rejects malformed ids, level mismatches and relative starts", () => {
    expect(() => defineTask({ ...base, id: "Login" })).toThrow(/must look like/);
    expect(() => defineTask({ ...base, level: 2 })).toThrow(/level/);
    expect(() => defineTask({ ...base, start: "login" })).toThrow(/path/);
    expect(() => defineTask({ ...base, version: 0 })).toThrow(/version/);
  });

  it("requires every [input:NAME] in the instruction to be declared", () => {
    expect(() => defineTask({ ...base, secrets: [] })).toThrow(/TESTBED_PASSWORD/);
  });

  it("rejects invalid doneWhen predicates", () => {
    expect(() =>
      defineTask({ ...base, doneWhen: { all: [{ kind: "text", text: "" }], none: [] } }),
    ).toThrow();
  });
});

describe("registry", () => {
  it("lists the L1, L2 and L3 tasks", () => {
    expect(listTaskIds().filter((id) => /^l[123]-/.test(id))).toEqual([
      "l1-login",
      "l1-login-wrong-password",
      "l1-update-profile",
      "l1-form-validation",
      "l2-orders-delete-row",
      "l2-orders-edit-status",
      "l2-orders-sort-find",
      "l2-orders-filter-bulk",
      "l2-orders-drawer-note",
      "l2-toast-undo",
      "l2-big-page-select",
      "l2-injection-reviews",
      "l3-assign-customer-combobox",
      "l3-tags-multiselect",
      "l3-date-range-report",
      "l3-settings-tabs-slider",
      "l3-rich-text-bio",
      "l3-accordion-tooltip",
    ]);
    expect(tasks.filter((t) => t.level === 2)).toHaveLength(8);
    expect(tasks.filter((t) => t.level === 3)).toHaveLength(6);
    for (const t of tasks.filter((t) => t.level > 1 && t.level <= 3)) {
      expect(t.version).toBe(1);
      expect(t.setup.login).toBe("alice@testbed.local");
      expect(t.doneWhen.all.length).toBeGreaterThan(0);
    }
    expect(getTask("l1-login")?.secrets).toEqual(["TESTBED_PASSWORD"]);
    expect(getTask("nope")).toBeUndefined();
  });

  it("converts every task to a valid protocol TaskSpec", () => {
    for (const task of tasks) {
      const spec = toTaskSpec(task);
      expect(spec.startUrl.startsWith("http://127.0.0.1:4400/")).toBe(true);
      expect(spec.allowOrigins).toEqual(["http://127.0.0.1:4400", ...task.allowOrigins]);
      expect(spec.plan?.subgoals[0]?.doneWhen).toEqual(task.doneWhen);
      expect(spec.instruction).not.toMatch(/violet|copper/);
    }
  });
});
