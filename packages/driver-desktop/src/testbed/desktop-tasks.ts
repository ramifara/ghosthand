// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Desktop testbed tasks. The GTK testbed app (testbed/desktop-testbed.py) writes its state to a JSON file in
// the sandbox's shared folder; oracles are pure functions over that state. The loop's own done check uses
// on-screen predicates only; the oracle grades the run afterwards.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Budget, DoneWhen, Result, TaskSpec } from "@ghosthand/protocol";
import { err, ok, TaskSpec as TaskSpecSchema } from "@ghosthand/protocol";
import { z } from "zod";

export const DesktopTestbedState = z.object({
  version: z.literal(1),
  profile: z
    .object({ name: z.string(), email: z.string(), plan: z.string().nullable(), newsletter: z.boolean() })
    .nullable(),
  items: z.array(z.string()),
  events: z.array(z.object({ t: z.number(), event: z.string() })),
});
export type DesktopTestbedState = z.infer<typeof DesktopTestbedState>;

export interface OracleVerdict {
  pass: boolean;
  detail: string;
}

export interface DesktopTask {
  id: string;
  version: number;
  /** testbed --seed */
  seed: "default" | "filled" | "empty";
  instruction: string;
  doneWhen: DoneWhen;
  /**
   * Task plan for instructions with independent parts (one subgoal each, like a mode C plan). Without it the
   * task is one subgoal with `doneWhen`.
   */
  subgoals?: ReadonlyArray<{ id: string; goal: string; doneWhen: DoneWhen }>;
  forbidden: string[];
  budget: Budget;
  oracle(state: DesktopTestbedState): OracleVerdict;
}

const BUDGET: Budget = { steps: 15, seconds: 150, usd: 0.05 };

export const DESKTOP_TASKS: readonly DesktopTask[] = [
  {
    id: "desktop-profile",
    version: 1,
    seed: "default",
    instruction:
      'In the profile form, set the full name to "Ada Lovelace" and the email to "ada@example.com", then save the profile.',
    doneWhen: {
      all: [
        { kind: "value", name: "Full name", value: "Ada Lovelace" },
        { kind: "value", name: "Email", value: "ada@example.com" },
        { kind: "text", text: "Profile saved:" },
      ],
      none: [],
    },
    forbidden: ["remove any shopping list item"],
    budget: BUDGET,
    oracle: (s) => {
      const p = s.profile;
      const pass = p?.name === "Ada Lovelace" && p.email === "ada@example.com";
      return { pass, detail: p ? `saved ${p.name} <${p.email}>` : "profile never saved" };
    },
  },
  {
    id: "desktop-plan",
    version: 1,
    seed: "filled",
    instruction: "Switch the plan to Pro, subscribe to the newsletter, then save the profile.",
    doneWhen: { all: [{ kind: "text", text: "Profile saved: Pro plan, newsletter on" }], none: [] },
    forbidden: ["remove any shopping list item"],
    budget: BUDGET,
    oracle: (s) => {
      const p = s.profile;
      const pass = p?.plan === "Pro" && p.newsletter === true && p.name === "Grace Hopper";
      return { pass, detail: p ? `saved plan ${p.plan}, newsletter ${p.newsletter}` : "profile never saved" };
    },
  },
  {
    id: "desktop-list",
    version: 1,
    seed: "default",
    instruction: 'Add "Milk" to the shopping list and remove "Bread" from it. Keep the other items.',
    doneWhen: { all: [{ kind: "text", text: "Milk" }], none: [{ kind: "text", text: "Bread" }] },
    // Both orders are valid next steps, so one subgoal splits the operation choice; a plan orders them.
    subgoals: [
      {
        id: "desktop-list-add",
        goal: 'Add "Milk" to the shopping list.',
        doneWhen: { all: [{ kind: "text", text: "Milk" }], none: [] },
      },
      {
        id: "desktop-list-remove",
        goal: 'Remove "Bread" from the shopping list. Keep the other items.',
        doneWhen: { all: [{ kind: "text", text: "Milk" }], none: [{ kind: "text", text: "Bread" }] },
      },
    ],
    forbidden: ["remove Eggs", "remove Coffee"],
    budget: BUDGET,
    oracle: (s) => {
      const want = ["Eggs", "Coffee", "Milk"];
      const pass = s.items.length === want.length && want.every((w, i) => s.items[i] === w);
      return { pass, detail: `items: ${s.items.join(", ") || "(none)"}` };
    },
  },
];

export const desktopTaskIds = (): string[] => DESKTOP_TASKS.map((t) => t.id);
export const getDesktopTask = (id: string): DesktopTask | undefined => DESKTOP_TASKS.find((t) => t.id === id);

/** The start target for desktop tasks: the sandbox launches the app on the first `open()`. */
export const DESKTOP_START = "desktop:app";

/** TaskSpec for the loop: one subgoal with on-screen done checks; commits are part of every task. */
export function desktopTaskSpec(task: DesktopTask): TaskSpec {
  return TaskSpecSchema.parse({
    id: task.id,
    mode: "do",
    instruction: task.instruction,
    startUrl: DESKTOP_START,
    plan: {
      source: "task",
      subgoals: (task.subgoals ?? [{ id: task.id, goal: task.instruction, doneWhen: task.doneWhen }]).map(
        (g) => ({ ...g, allowedEffects: ["advance", "commit"] }),
      ),
    },
    budget: task.budget,
    forbidden: task.forbidden,
  });
}

export type StateError = { kind: "missing" | "invalid"; message: string };

export function readDesktopState(workDir: string): Result<DesktopTestbedState, StateError> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(workDir, "state.json"), "utf8"));
  } catch (e) {
    return err({ kind: "missing", message: e instanceof Error ? e.message : String(e) });
  }
  const parsed = DesktopTestbedState.safeParse(raw);
  if (!parsed.success) return err({ kind: "invalid", message: parsed.error.issues[0]?.message ?? "invalid" });
  return ok(parsed.data);
}

/** Grades a task from the state file in the sandbox's shared folder. */
export function gradeDesktopTask(task: DesktopTask, workDir: string): OracleVerdict {
  const state = readDesktopState(workDir);
  if (!state.ok) return { pass: false, detail: `state ${state.error.kind}: ${state.error.message}` };
  return task.oracle(state.value);
}
