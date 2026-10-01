// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Testbed glue: resets and seeds via the control API, signs in per task setup, and grades with the oracle.
// The oracle is the final verdict only; the agent's own done_when never consults it.
import type { TaskSpec } from "@ghosthand/protocol";
import {
  APP_ORIGIN,
  CONTROL_ORIGIN,
  type ControlClient,
  createControlClient,
  fixtureSecrets,
  getTask,
  listTaskIds,
  type TestbedTask,
  toTaskSpec,
} from "@ghosthand/testbed-kit";

export interface BrowserCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  url?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  expires?: number;
}

export interface PreparedTestbedRun {
  task: TestbedTask;
  /** TaskSpec for the loop, with oracle predicates removed from done_when. */
  spec: TaskSpec;
  cookies: BrowserCookie[];
  secrets: Record<string, string>;
  oracle: (taskId: string, answer?: string) => Promise<boolean | undefined>;
  control: ControlClient;
}

export type TestbedError = { kind: "unknown_task" | "control"; message: string };

export const testbedTaskIds = (): string[] => listTaskIds();

/** Removes oracle predicates so the loop judges completion from the page alone. */
export function withoutOracle(spec: TaskSpec): TaskSpec {
  if (!spec.plan) return spec;
  return {
    ...spec,
    plan: {
      ...spec.plan,
      subgoals: spec.plan.subgoals.map((g) => ({
        ...g,
        doneWhen: { all: g.doneWhen.all.filter((p) => p.kind !== "oracle"), none: g.doneWhen.none },
        // Testbed tasks state their consequential effects explicitly in the instruction.
        allowedEffects: g.allowedEffects.includes("commit")
          ? g.allowedEffects
          : [...g.allowedEffects, "commit"],
      })),
    },
  };
}

export interface PrepareOptions {
  appOrigin?: string;
  controlOrigin?: string;
  fetch?: typeof fetch;
}

export async function prepareTestbedRun(
  taskId: string,
  opts: PrepareOptions = {},
): Promise<{ ok: true; value: PreparedTestbedRun } | { ok: false; error: TestbedError }> {
  const task = getTask(taskId);
  if (!task) {
    return {
      ok: false,
      error: {
        kind: "unknown_task",
        message: `unknown testbed task "${taskId}" (known: ${listTaskIds().join(", ")})`,
      },
    };
  }
  const appOrigin = opts.appOrigin ?? APP_ORIGIN;
  const control = createControlClient({
    baseUrl: opts.controlOrigin ?? CONTROL_ORIGIN,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const prepared = await control.prepare(task);
  if (!prepared.ok) {
    return {
      ok: false,
      error: {
        kind: "control",
        message: `testbed control API at ${opts.controlOrigin ?? CONTROL_ORIGIN} failed (${prepared.error.kind}): ${prepared.error.message}. Is \`bun run dev:testbed\` running?`,
      },
    };
  }
  const cookies: BrowserCookie[] = [];
  const c = prepared.value.cookie;
  if (c) {
    cookies.push({
      name: c.name,
      value: c.value,
      url: appOrigin,
      httpOnly: true,
      sameSite: "Lax",
    });
  }
  const secrets: Record<string, string> = {};
  for (const name of task.secrets) {
    const value = (fixtureSecrets as Record<string, string>)[name];
    if (value !== undefined) secrets[name] = value;
  }
  return {
    ok: true,
    value: {
      task,
      spec: withoutOracle(toTaskSpec(task, appOrigin)),
      cookies,
      secrets,
      control,
      oracle: async (id, answer) => {
        const r = await control.oracle(id, answer === undefined ? {} : { answer });
        return r.ok ? r.value.pass : undefined;
      },
    },
  };
}
