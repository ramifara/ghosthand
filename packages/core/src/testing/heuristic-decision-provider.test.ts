// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { HeuristicDecisionProvider } from "./heuristic-decision-provider.ts";

describe("HeuristicDecisionProvider", () => {
  it("abstains on box questions and advertises no image support", async () => {
    const p = new HeuristicDecisionProvider();
    expect(p.capabilities.images ?? false).toBe(false);
    const r = await p.ask(
      { task: { goal: "x" } },
      { where: { type: "box", instructions: "the Save button" } },
    );
    expect(r.ok && r.value.answers.where).toMatchObject({
      type: "abstain",
      reason: expect.stringMatching(/box/),
    });
  });
});
