// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// @vitest-environment jsdom
import { RunEvent, StartRunInput } from "@ghosthand/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../stores/ui-store.ts";
import { loadRunTask, taskInputFromRecording } from "./reuse-task.ts";

const start = RunEvent.parse({
  t: 1790860916475,
  seq: 0,
  runId: "20261001-132156-8ns7l5",
  type: "run.start",
  task: {
    id: "l1-login",
    instruction: "Sign in with [input:TESTBED_PASSWORD]",
    startUrl: "http://127.0.0.1:4400/login",
    allowOrigins: ["http://127.0.0.1:4400"],
  },
  gitSha: "c4ebf3b",
  decisionModel: "heuristic",
  surface: "chrome 151 / profile default",
});
const task = { id: "l1-login", version: 1, level: 1, start: "/login", instruction: "Sign in" };

describe("reuse recorded tasks", () => {
  beforeEach(() => useUiStore.getState().reset());
  afterEach(() => {
    delete window.ghosthand;
  });

  it("loads an older testbed recording into the selector with its recorded profile and decision", () => {
    expect(taskInputFromRecording([start], [task])).toEqual({
      ok: true,
      value: {
        source: { kind: "testbed", taskId: "l1-login" },
        profile: "default",
        decision: "heuristic",
      },
    });
  });

  it("loads a recorded goal with its origin list without using action text or secret values", () => {
    if (start.type !== "run.start") throw new Error("expected a run start fixture");
    const event = {
      ...start,
      task: {
        ...start.task,
        id: "adhoc",
        instruction: "Sign in with [input:PASSWORD]",
        allowOrigins: ["https://accounts.example.com"],
        startUrl: "https://app.example.com",
      },
      decisionModel: "typesafe/jev",
      surface: "chrome 151 / profile work",
    };
    expect(taskInputFromRecording([event], [task])).toEqual({
      ok: true,
      value: {
        source: {
          kind: "goal",
          goal: "Sign in with [input:PASSWORD]",
          startUrl: "https://app.example.com",
          allowOrigins: ["https://accounts.example.com"],
        },
        profile: "work",
        decision: "jev",
      },
    });
  });

  it("does not fabricate a task for a missing or unusable recording", () => {
    expect(taskInputFromRecording([], [task]).ok).toBe(false);
    if (start.type !== "run.start") throw new Error("expected a run start fixture");
    expect(
      taskInputFromRecording(
        [{ ...start, task: { ...start.task, id: "adhoc", startUrl: "file:///etc/passwd" } }],
        [],
      ).ok,
    ).toBe(false);
  });

  it("uses the exact recent submission without making IPC calls or starting a run", async () => {
    const input = StartRunInput.parse({
      source: { kind: "goal", goal: "Find pricing", startUrl: "https://app.example.com" },
      profile: "work",
      planner: "none",
      writer: "none",
      showBrowser: false,
      unattended: true,
    });
    useUiStore.getState().rememberRun("r1", input);
    const invoke = vi.fn();
    window.ghosthand = { invoke, onPush: () => () => {}, onEngineMessage: () => () => {}, platform: "linux" };
    expect(await loadRunTask("r1")).toEqual(input);
    expect(invoke).not.toHaveBeenCalled();
  });
});
