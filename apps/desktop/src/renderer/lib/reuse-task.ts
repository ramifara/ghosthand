// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { RunEvent, TaskListItem } from "@ghosthand/protocol";
import { err, ok, StartRunInput } from "@ghosthand/protocol";
import { useUiStore } from "../stores/ui-store.ts";
import { call } from "./bridge.ts";

/** Older/CLI runs have a recorded task, but no desktop launch fields. Use current defaults for those. */
export function taskInputFromRecording(events: readonly RunEvent[], tasks: readonly TaskListItem[]) {
  const start = events.find((event) => event.type === "run.start");
  if (start?.type !== "run.start") return err({ message: "This run has no recorded task to reuse." });
  const profile = /\/ profile ([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(start.surface ?? "")?.[1];
  const parsed = StartRunInput.safeParse({
    source: tasks.some((task) => task.id === start.task.id)
      ? { kind: "testbed", taskId: start.task.id }
      : {
          kind: "goal",
          goal: start.task.instruction,
          startUrl: start.task.startUrl,
          allowOrigins: start.task.allowOrigins,
        },
    ...(profile ? { profile } : {}),
    decision: start.decisionModel.startsWith("heuristic") ? "heuristic" : "jev",
  });
  return parsed.success
    ? ok(parsed.data)
    : err({ message: "This recorded task cannot be loaded into the task composer." });
}

export async function loadRunTask(runId: string): Promise<StartRunInput> {
  const cached = useUiStore.getState().recentTasks.find((task) => task.runId === runId);
  if (cached) return cached.input;
  const [log, tasks] = await Promise.all([call("runs.events", { runId }), call("tasks.list", {})]);
  const input = taskInputFromRecording(log.events, tasks);
  if (!input.ok) throw new Error(input.error.message);
  return input.value;
}
