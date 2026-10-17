// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The fixture is a real recorded run from the desktop app (l1-login, plumbing mode, one takeover).
import { RunEvent } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { projectRect } from "../live/overlay-geometry.ts";
import fixture from "./__fixtures__/l1-login-takeover.events.jsonl?raw";
import { deriveRun } from "./derive-steps.ts";

const events = fixture
  .trim()
  .split("\n")
  .map((l: string) => RunEvent.parse(JSON.parse(l)));

describe("deriveRun", () => {
  const { header, steps } = deriveRun(events);

  it("reads the run header and plan", () => {
    expect(header.taskId).toBe("l1-login");
    expect(header.decisionModel).toBe("heuristic");
    expect(header.end?.outcome).toBe("success");
    expect(header.subgoals.length).toBeGreaterThan(0);
    expect(header.subgoals.every((g) => g.state === "satisfied")).toBe(true);
  });

  it("makes one row per step with the action, Jev heads, gates, effect and timing", () => {
    const acting = steps.filter((s) => s.action);
    expect(acting.map((s) => s.action?.type)).toEqual(["set_value", "set_value", "press"]);
    const press = acting[2];
    expect(press?.status).toBe("acted");
    expect(press?.action?.summary).toBe("press button “Sign in”");
    expect(press?.action?.target?.confidence).toBeCloseTo(0.95);
    expect(press?.action?.target?.bounds).toBeDefined();
    const op = press?.decisions[0]?.answers[0];
    expect(op).toMatchObject({ head: "operation", value: "press" });
    expect(op?.top[0]?.key).toBe("press");
    expect(press?.gates.every((g) => g.passed)).toBe(true);
    expect(press?.effect?.effect).toBe("confirmed");
    expect(press?.timing?.decideMs).toBeGreaterThanOrEqual(0);
  });

  it("never shows a secret value, only the placeholder", () => {
    const password = steps.find((s) => s.action?.summary.includes("Password"));
    expect(password?.action?.summary).toContain("[input:TESTBED_PASSWORD]");
  });

  it("records the takeover on its step", () => {
    expect(steps.flatMap((s) => s.human).map((h) => h.kind)).toEqual(["takeover"]);
  });

  it("ends with the verify step", () => {
    expect(steps.at(-1)?.verify).toEqual({ state: "satisfied", decidedBy: "deterministic" });
    expect(steps.at(-1)?.status).toBe("verified");
  });

  it("is empty for no events", () => {
    expect(deriveRun([])).toEqual({ header: { subgoals: [] }, steps: [] });
  });
});

describe("projectRect", () => {
  it("maps CSS pixels to percentages of the frame", () => {
    expect(
      projectRect({ x: 128, y: 86, width: 256, height: 43 }, { deviceWidth: 1280, deviceHeight: 860 }),
    ).toEqual({
      left: 10,
      top: 10,
      width: 20,
      height: 5,
    });
  });
  it("clips to the frame and drops boxes outside it", () => {
    expect(
      projectRect({ x: -100, y: 0, width: 200, height: 10 }, { deviceWidth: 1000, deviceHeight: 1000 }),
    ).toEqual({
      left: 0,
      top: 0,
      width: 10,
      height: 1,
    });
    expect(
      projectRect({ x: 2000, y: 0, width: 10, height: 10 }, { deviceWidth: 1000, deviceHeight: 1000 }),
    ).toBeUndefined();
    expect(
      projectRect({ x: 0, y: 0, width: 0, height: 10 }, { deviceWidth: 1000, deviceHeight: 1000 }),
    ).toBeUndefined();
  });
});

describe("D0 actions (ADR 0020)", () => {
  it("carries the box Jev located into the step's action target", () => {
    const base = { runId: "r", t: 1 };
    const run = deriveRun([
      RunEvent.parse({
        ...base,
        seq: 0,
        type: "action",
        step: 3,
        action: { type: "click", target: { captureId: "c1", x: 10, y: 10 } },
        target: {
          stableId: "d0|save",
          role: "unknown",
          name: "the Save button",
          box: { top: 0.75, bottom: 0.79, left: 0.19, right: 0.3 },
        },
        mode: "D0",
      }),
    ]);
    const step = run.steps.find((s) => s.step === 3);
    expect(step?.mode).toBe("D0");
    expect(step?.action?.target?.box).toEqual({ top: 0.75, bottom: 0.79, left: 0.19, right: 0.3 });
  });
});
