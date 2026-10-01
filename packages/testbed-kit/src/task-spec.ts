// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Converts a testbed task into the protocol TaskSpec the step loop consumes.
import { TaskSpec } from "@ghosthand/protocol";
import type { TestbedTask } from "./define-task.ts";
import { APP_ORIGIN } from "./fixtures.ts";

export function toTaskSpec(task: TestbedTask, appOrigin: string = APP_ORIGIN): TaskSpec {
  return TaskSpec.parse({
    id: task.id,
    mode: "do",
    instruction: task.instruction,
    startUrl: new URL(task.start, appOrigin).href,
    allowOrigins: [new URL(appOrigin).origin],
    plan: {
      source: "task",
      subgoals: [{ id: task.id, goal: task.instruction, doneWhen: task.doneWhen }],
    },
    budget: task.budget,
    secrets: [...task.secrets],
    forbidden: [...task.forbidden],
    expectsAnswer: task.expectsAnswer,
  });
}
