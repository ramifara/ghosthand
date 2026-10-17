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
    expect(t.budget.steps).toBe(60);
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

describe("Jev 1.14: box questions, box answers and images (ADR 0020)", () => {
  it("parses a box question and a box answer", () => {
    expect(Question.parse({ type: "box", instructions: "The Save button in `screen`" })).toEqual({
      type: "box",
      instructions: "The Save button in `screen`",
    });
    const a = Answer.parse({
      type: "box",
      box: { top: 0.1, bottom: 0.2, left: 0.3, right: 0.4 },
      confidence: null,
    });
    expect(a).toMatchObject({ type: "box", confidence: null });
  });

  it("isValidBox requires ordered edges inside the unit square", async () => {
    const { isValidBox } = await import("./index.ts");
    expect(isValidBox({ top: 0.1, bottom: 0.2, left: 0.3, right: 0.4 })).toBe(true);
    expect(isValidBox({ top: 0.2, bottom: 0.1, left: 0.3, right: 0.4 })).toBe(false);
    expect(isValidBox({ top: 0, bottom: 1, left: 0, right: 1.01 })).toBe(false);
    expect(isValidBox({ top: 0.5, bottom: 0.5, left: 0, right: 1 })).toBe(false);
  });

  it("parses image metadata and capability flags", async () => {
    const { DecisionImage, DecisionCapabilities, DecisionErrorKind } = await import("./index.ts");
    expect(
      DecisionImage.parse({
        ref: "<image:screen>",
        mimeType: "image/jpeg",
        width: 1280,
        height: 834,
        captureId: "c1",
      }),
    ).toMatchObject({ ref: "<image:screen>" });
    expect(
      DecisionImage.safeParse({ ref: "screen", mimeType: "image/png", width: 1, height: 1 }).success,
    ).toBe(false);
    expect(
      DecisionCapabilities.parse({
        maxOptions: 255,
        maxLevels: 10,
        contextTokens: 64_000,
        zdr: false,
        images: true,
        box: true,
        imageLimits: {
          minSide: 280,
          maxSide: 1568,
          minPixels: 78_400,
          maxPixels: 2_458_624,
          maxBytes: 16_777_216,
        },
      }).box,
    ).toBe(true);
    expect(DecisionErrorKind.parse("image_rejected")).toBe("image_rejected");
  });

  it("records images and a ground purpose on decision.request, D0 and a box on action", () => {
    const base = { t: 1, seq: 1, runId: "r" };
    expect(
      RunEvent.safeParse({
        ...base,
        type: "decision.request",
        step: 1,
        purpose: "ground",
        questions: { where: { type: "box", instructions: "x" } },
        stateTokens: 3000,
        model: "jev-1.14.0",
        images: [
          {
            ref: "<image:screen>",
            mimeType: "image/jpeg",
            width: 1280,
            height: 834,
            captureId: "c1",
            file: "step-001.jpg",
            tokens: 3012,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      RunEvent.safeParse({
        ...base,
        type: "action",
        step: 1,
        action: { type: "click", target: { captureId: "c1", x: 10, y: 10 } },
        target: {
          stableId: "s",
          role: "button",
          name: "Save",
          box: { top: 0.1, bottom: 0.2, left: 0.3, right: 0.4 },
        },
        mode: "D0",
      }).success,
    ).toBe(true);
  });

  it("config defaults: images for grounding only, no vision model pin, box gates", () => {
    const c = GhostHandConfig.parse({});
    expect(c.decision.images).toBe("grounding");
    expect(c.decision.visionModel).toBeUndefined();
    expect(c.gates.boxPresent).toBe(0.7);
    expect(c.gates.boxMaxArea).toBe(0.25);
    expect(GhostHandConfig.safeParse({ decision: { images: "sometimes" } }).success).toBe(false);
  });
});
