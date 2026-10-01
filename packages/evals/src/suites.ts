// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Suites are named selections of testbed tasks. Released tasks are frozen and versioned (`id@version`).
import { tasks as allTasks, type TestbedTask } from "@ghosthand/testbed-kit";

export const SUITES: Record<string, (t: TestbedTask) => boolean> = {
  smoke: (t) => t.id === "l1-login",
  l1: (t) => t.level <= 1,
  "l1-l2": (t) => t.level <= 2,
  "l1-l3": (t) => t.level <= 3,
  l2: (t) => t.level === 2,
  l3: (t) => t.level === 3,
  all: () => true,
};

export type SuiteError = { kind: "unknown_suite" | "empty"; message: string };

export function selectTasks(
  suite: string,
  opts: { only?: string[]; tasks?: readonly TestbedTask[] } = {},
): { ok: true; value: TestbedTask[] } | { ok: false; error: SuiteError } {
  const pool = opts.tasks ?? allTasks;
  const filter = SUITES[suite];
  if (!filter) {
    return {
      ok: false,
      error: {
        kind: "unknown_suite",
        message: `unknown suite "${suite}" (known: ${Object.keys(SUITES).join(", ")})`,
      },
    };
  }
  const picked = pool.filter(filter).filter((t) => !opts.only || opts.only.includes(t.id));
  if (picked.length === 0)
    return { ok: false, error: { kind: "empty", message: `suite "${suite}" selects no tasks` } };
  return { ok: true, value: picked };
}

export const taskRef = (t: Pick<TestbedTask, "id" | "version">): string => `${t.id}@${t.version}`;
