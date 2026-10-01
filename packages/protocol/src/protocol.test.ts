// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Action,
  ActionResult,
  Answer,
  Element,
  err,
  GhostHandConfig,
  isErr,
  isOk,
  mapResult,
  ok,
  Question,
  RunEvent,
  Snapshot,
  TaskSpec,
  unwrap,
} from "./index.ts";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

describe("Result", () => {
  it("maps and unwraps", () => {
    expect(unwrap(mapResult(ok(2), (n) => n * 2))).toBe(4);
    const e = err({ kind: "timeout" as const });
    expect(isErr(e)).toBe(true);
    expect(isOk(mapResult(e, () => 1))).toBe(false);
    expect(() => unwrap(e)).toThrow(/timeout/);
  });
});

describe("Snapshot and Element", () => {
  it("parses a login snapshot fixture", () => {
    const snap = Snapshot.parse(JSON.parse(fixture("login-snapshot.json")));
    expect(snap.elements).toHaveLength(3);
    expect(snap.elements[1]?.value).toBe("[input:TESTBED_PASSWORD]");
  });

  it("rejects an element with an unknown role class or missing token", () => {
    const base = JSON.parse(fixture("login-snapshot.json")).elements[0];
    expect(Element.safeParse({ ...base, roleClass: "widget" }).success).toBe(false);
    expect(Element.safeParse({ ...base, token: "" }).success).toBe(false);
    const { frame: _frame, ...noFrame } = base;
    expect(Element.safeParse(noFrame).success).toBe(false);
  });
});

describe("Action and ActionResult", () => {
  it("accepts semantic, pointer and secret actions", () => {
    expect(Action.parse({ type: "press", token: "e5" }).type).toBe("press");
    expect(
      Action.parse({ type: "set_value", token: "e4", value: { secretRef: "TESTBED_PASSWORD" } }).type,
    ).toBe("set_value");
    expect(Action.parse({ type: "click", target: { captureId: "c1", x: 10, y: 20 } }).type).toBe("click");
  });

  it("rejects malformed actions", () => {
    expect(Action.safeParse({ type: "press" }).success).toBe(false);
    expect(Action.safeParse({ type: "teleport", token: "e1" }).success).toBe(false);
    expect(
      Action.safeParse({ type: "set_value", token: "e4", value: { secretRef: "bad name!" } }).success,
    ).toBe(false);
    expect(Action.safeParse({ type: "wait", ms: 60_000 }).success).toBe(false);
  });

  it("requires a known effect", () => {
    const r = {
      effect: "confirmed",
      route: "semantic",
      evidence: [],
      invalidatedSnapshots: [],
      durationMs: 3,
    };
    expect(ActionResult.safeParse(r).success).toBe(true);
    expect(ActionResult.safeParse({ ...r, effect: "probably" }).success).toBe(false);
  });
});

describe("Decision questions and answers", () => {
  it("enforces option and level limits", () => {
    const many = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`o${i}`, null]));
    expect(Question.safeParse({ type: "choice", criteria: many }).success).toBe(false);
    expect(Question.safeParse({ type: "choice", criteria: { only: null } }).success).toBe(false);
    expect(Question.safeParse({ type: "score", criteria: ["a"] }).success).toBe(false);
    expect(Question.safeParse({ type: "score", criteria: ["a", null] }).success).toBe(false);
    expect(
      Question.safeParse({ type: "score", criteria: Array.from({ length: 11 }, (_, i) => `l${i}`) }).success,
    ).toBe(false);
    expect(Question.safeParse({ type: "noul", instructions: "Is the form submitted?" }).success).toBe(true);
  });

  it("parses answers and rejects out-of-range probabilities", () => {
    expect(Answer.parse({ type: "noul", p: 0.2 }).type).toBe("noul");
    expect(Answer.safeParse({ type: "noul", p: 1.2 }).success).toBe(false);
    expect(Answer.safeParse({ type: "choice", choice: "a", confidence: 0.9 }).success).toBe(false);
    expect(Answer.parse({ type: "abstain", reason: "probabilities do not sum to 1" }).type).toBe("abstain");
  });
});

describe("RunEvent", () => {
  it("parses every line of an events.jsonl fixture", () => {
    const lines = fixture("events.jsonl").trim().split("\n");
    const events = lines.map((l) => RunEvent.parse(JSON.parse(l)));
    expect(events.map((e) => e.type)).toContain("run.end");
  });

  it("rejects an event with an unknown type or missing seq", () => {
    expect(RunEvent.safeParse({ t: 1, seq: 0, runId: "r", type: "run.pause" }).success).toBe(false);
    expect(
      RunEvent.safeParse({ t: 1, runId: "r", type: "plan", plan: { subgoals: [], source: "task" } }).success,
    ).toBe(false);
  });
});

describe("TaskSpec and config defaults", () => {
  it("fills defaults", () => {
    const t = TaskSpec.parse({ id: "adhoc", instruction: "Sign in", startUrl: "http://127.0.0.1:4400" });
    expect(t.budget.steps).toBe(25);
    expect(t.mode).toBe("do");
    const c = GhostHandConfig.parse({});
    expect(c.decision.provider).toBe("typesafe");
    expect(c.decision.model).toBeUndefined();
    expect(c.models.discoverLocal).toBe(true);
    expect(c.consultant.claude.enabled).toBe(false);
    expect(c.decision.timeoutMs).toBe(2500);
    expect(c.gates.operation).toBe(0.65);
    expect(c.gates.target).toBe(0.7);
  });

  it("rejects bad config", () => {
    expect(GhostHandConfig.safeParse({ gates: { target: 2 } }).success).toBe(false);
    expect(GhostHandConfig.safeParse({ browser: { channel: "firefox" } }).success).toBe(false);
    expect(GhostHandConfig.safeParse({ decision: { provider: "cloudflare" } }).success).toBe(false);
    expect(GhostHandConfig.safeParse({ decision: { apiKeyEnv: "sk-or-v1-abc" } }).success).toBe(false);
    expect(GhostHandConfig.safeParse({ models: { local: [{ id: "vllm", baseUrl: "nope" }] } }).success).toBe(
      false,
    );
  });
});
