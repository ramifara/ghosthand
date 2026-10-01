// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { PassThrough } from "node:stream";
import type { ApprovalRequest } from "@ghosthand/core";
import { describe, expect, it } from "vitest";
import { createApprover } from "./approve.ts";

const req = {
  step: 3,
  action: { type: "press", token: "e5" },
  element: undefined,
  effect: "commit",
  subgoal: {
    id: "s",
    goal: "Delete the order",
    doneWhen: { all: [], none: [] },
    allowedEffects: ["advance"],
    maxSteps: 5,
    seedTargets: [],
  },
} satisfies ApprovalRequest;

describe("approver", () => {
  it("denies without a terminal unless --yes", async () => {
    const out = new PassThrough();
    const input = Object.assign(new PassThrough(), { isTTY: false });
    expect(await createApprover({ yes: false, input, output: out })(req)).toBe(false);
    expect(await createApprover({ yes: true, input, output: out })(req)).toBe(true);
  });
  it("asks on a terminal", async () => {
    const out = new PassThrough();
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const p = createApprover({ yes: false, input, output: out })(req);
    input.write("y\n");
    expect(await p).toBe(true);
  });
});
