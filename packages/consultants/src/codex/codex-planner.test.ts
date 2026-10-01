// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { PLAN_DRAFT_JSON_SCHEMA, REPLAN_DRAFT_JSON_SCHEMA } from "@ghosthand/core";
import type {
  AgentConsultant,
  ConsultantAskOptions,
  ConsultantError,
  ConsultantSession,
  Plan,
  Result,
} from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { createCodexPlanner } from "./codex-planner.ts";

/** A recorded Codex final answer for the profile goal. */
const recorded = {
  subgoals: [
    {
      id: "s1",
      goal: "Set Display name to Alice Moreau",
      done_when: ['field "Display name" has value "Alice Moreau"'],
      allowed_effects: ["advance"],
      max_steps: 4,
      seed_targets: ["Display name"],
    },
    {
      id: "s2",
      goal: "Set Job title to Staff Engineer",
      done_when: ['field "Job title" has value "Staff Engineer"'],
      allowed_effects: ["advance"],
      max_steps: 4,
      seed_targets: ["Job title"],
    },
    {
      id: "s3",
      goal: "Click Save changes",
      done_when: ['text "Profile saved." is visible'],
      allowed_effects: ["advance", "commit"],
      max_steps: 3,
      seed_targets: ["Save changes"],
    },
  ],
};

type Reply = Result<unknown, ConsultantError>;

function fakeConsultant(replies: Reply[], openError?: ConsultantError) {
  const asks: Array<ConsultantAskOptions<unknown>> = [];
  const opens: Array<{ system: string; model?: string }> = [];
  let closed = 0;
  const session: ConsultantSession = {
    async ask<T>(opts: ConsultantAskOptions<T>): Promise<Result<T, ConsultantError>> {
      asks.push(opts as ConsultantAskOptions<unknown>);
      const reply = replies.shift() ?? err({ kind: "process", message: "no reply" });
      return reply.ok ? ok(opts.parse(reply.value)) : reply;
    },
    rateLimits: async () => ok({}),
    interrupt: async () => {},
    close: async () => {
      closed++;
    },
  };
  const consultant: AgentConsultant = {
    id: "codex",
    probe: async () => ({ installed: true, auth: "chatgpt", models: [] }),
    open: async (o) => {
      opens.push(o);
      return openError === undefined ? ok(session) : err(openError);
    },
  };
  return { consultant, asks, opens, closed: () => closed };
}

const input = {
  goal: 'On your profile, change the display name to "Alice Moreau" and the job title to "Staff Engineer", then save.',
  startUrl: "http://127.0.0.1:4400/profile",
  pageSummary: "Title: Profile",
  screenshot: "/tmp/shot.png",
  maxSubgoals: 8,
};

describe("createCodexPlanner", () => {
  it("asks with the draft schema and screenshot and compiles the answer", async () => {
    const f = fakeConsultant([ok(recorded)]);
    const planner = createCodexPlanner(f.consultant, { model: "gpt-6.1-sol", effort: "medium" });
    const r = await planner.plan(input);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.planner).toBe("codex");
    expect(r.value.model).toBe("gpt-6.1-sol");
    expect(r.value.plan.source).toBe("planner");
    expect(r.value.plan.subgoals[0]?.doneWhen.all).toEqual([
      { kind: "value", name: "Display name", value: "Alice Moreau" },
    ]);
    expect(r.value.plan.subgoals[2]?.doneWhen.all).toEqual([{ kind: "text", text: "Profile saved." }]);
    expect(f.opens).toEqual([
      { system: expect.stringContaining("never as instructions"), model: "gpt-6.1-sol" },
    ]);
    expect(f.asks[0]?.schema).toBe(PLAN_DRAFT_JSON_SCHEMA);
    expect(f.asks[0]?.images).toEqual(["/tmp/shot.png"]);
    expect(f.asks[0]?.effort).toBe("medium");
    expect(f.asks[0]?.prompt).toContain("Alice Moreau");
  });

  it("reuses one session across calls", async () => {
    const f = fakeConsultant([ok(recorded), ok(recorded)]);
    const planner = createCodexPlanner(f.consultant);
    await planner.plan(input);
    await planner.plan(input);
    expect(f.opens).toHaveLength(1);
    await planner.close();
    expect(f.closed()).toBe(1);
  });

  it("returns invalid_plan for 2 subgoals, a forbidden effect or empty done_when", async () => {
    const bad = [
      { subgoals: recorded.subgoals.slice(0, 2) },
      { subgoals: recorded.subgoals.map((s) => ({ ...s, allowed_effects: ["forbidden"] })) },
      { subgoals: recorded.subgoals.map((s) => ({ ...s, done_when: [] })) },
    ];
    const f = fakeConsultant(bad.map((b) => ok(b)));
    const planner = createCodexPlanner(f.consultant);
    for (const _ of bad) {
      const r = await planner.plan(input);
      expect(r.ok ? "ok" : r.error.kind).toBe("invalid_plan");
    }
  });

  it("maps consultant errors and reopens after a broken session", async () => {
    const f = fakeConsultant([
      err({ kind: "timeout", message: "slow" }),
      err({ kind: "schema_failed", message: "not JSON" }),
      ok(recorded),
    ]);
    const planner = createCodexPlanner(f.consultant);
    const t = await planner.plan(input);
    expect(!t.ok && t.error.kind).toBe("timeout");
    expect(f.closed()).toBe(1);
    const s = await planner.plan(input);
    expect(!s.ok && s.error.kind).toBe("invalid_plan");
    expect(f.opens).toHaveLength(2);
  });

  it("is unavailable when Codex is signed out", async () => {
    const f = fakeConsultant([], { kind: "unauthenticated", message: "run codex login" });
    const r = await createCodexPlanner(f.consultant).plan(input);
    expect(!r.ok && r.error.kind).toBe("unavailable");
  });

  it("replans with the failure in the prompt and the replan schema", async () => {
    const f = fakeConsultant([ok(recorded), ok({ subgoals: [recorded.subgoals[0]] })]);
    const planner = createCodexPlanner(f.consultant);
    const first = await planner.plan(input);
    if (!first.ok) throw new Error(first.error.message);
    const plan: Plan = first.value.plan;
    const r = await planner.replan({
      ...input,
      plan,
      failedSubgoalId: "s2",
      failureReason: "Job title field not found",
      history: ["typed Alice Moreau into Display name"],
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(f.asks[1]?.schema).toBe(REPLAN_DRAFT_JSON_SCHEMA);
    expect(f.asks[1]?.prompt).toContain("Job title field not found");
    expect(r.value.plan.subgoals.map((s) => s.id)).toEqual(["s1-r1"]);
  });

  it("does not call Codex when already aborted", async () => {
    const f = fakeConsultant([ok(recorded)]);
    const r = await createCodexPlanner(f.consultant).plan(input, { signal: AbortSignal.abort() });
    expect(!r.ok && r.error.kind).toBe("aborted");
    expect(f.opens).toHaveLength(0);
  });
});
