// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { ApprovalRequest } from "@ghosthand/core";
import type { Element } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { RunController, toApprovalView } from "./run-controller.ts";

const element = {
  token: "e5",
  stableId: "s",
  role: "button",
  roleClass: "action",
  nativeRole: "button",
  name: "Delete order",
  states: [],
  actions: ["press"],
  bounds: { x: 10, y: 20, width: 80, height: 24 },
  visibleBounds: null,
  boundsTrust: "exact",
  region: "main",
  frame: "main",
  risk: "destructive",
  context: "Order ord_1001",
} as unknown as Element;

const req = (step = 3): ApprovalRequest => ({
  step,
  action: { type: "press", token: "e5" },
  element,
  effect: "commit",
  subgoal: {
    id: "g",
    goal: "Delete the order",
    doneWhen: { all: [], none: [] },
    allowedEffects: ["advance"],
    maxSteps: 5,
    seedTargets: [],
  },
});

function setup() {
  const log: string[] = [];
  let now = 1000;
  const c = new RunController(
    {
      status: (s) => log.push(`status:${s}`),
      approvalRequested: (v) => log.push(`ask:${v.requestId}`),
      approvalResolved: (id, d) => log.push(`resolved:${id}:${d}`),
    },
    () => now,
  );
  return { c, log, advance: (ms: number) => (now += ms) };
}

describe("RunController", () => {
  it("pauses checkpoints until resume and reports the paused time", async () => {
    const { c, log, advance } = setup();
    expect(await c.checkpoint()).toBe(0);
    expect(c.pause()).toBe(true);
    expect(c.pause()).toBe(false);
    const waiting = c.checkpoint();
    advance(2500);
    c.resume();
    expect(await waiting).toBe(2500);
    expect(log).toEqual(["status:paused", "status:running"]);
  });

  it("stop releases a paused checkpoint and denies pending approvals", async () => {
    const { c, log } = setup();
    c.pause();
    const waiting = c.checkpoint();
    const approval = c.approve(req());
    c.stop();
    expect(await waiting).toBeGreaterThan(0);
    expect(await approval).toBe(false);
    expect(c.abort.signal.aborted).toBe(true);
    expect(log).toContain("resolved:a1:deny");
    expect(await c.approve(req())).toBe(false);
  });

  it("approve once, then for the whole task", async () => {
    const { c, log } = setup();
    const first = c.approve(req(1));
    expect(c.respond("a1", "once")).toBe(true);
    expect(await first).toBe(true);
    const second = c.approve(req(2));
    expect(c.respond("a2", "task")).toBe(true);
    expect(await second).toBe(true);
    expect(await c.approve(req(3))).toBe(true);
    expect(log).toEqual(["ask:a1", "resolved:a1:once", "ask:a2", "resolved:a2:task", "resolved:a3:task"]);
    expect(c.respond("a9", "once")).toBe(false);
  });

  it("deny returns false", async () => {
    const { c } = setup();
    const p = c.approve(req());
    c.respond("a1", "deny");
    expect(await p).toBe(false);
  });

  it("builds an approval view with the target and its box", () => {
    const v = toApprovalView("a7", req());
    expect(v).toMatchObject({
      requestId: "a7",
      step: 3,
      actionType: "press",
      effect: "commit",
      describe: 'press button "Delete order"',
      target: {
        role: "button",
        name: "Delete order",
        context: "Order ord_1001",
        bounds: { x: 10, y: 20, width: 80, height: 24 },
      },
    });
  });
});
