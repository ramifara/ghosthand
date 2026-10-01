// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { DecisionProvider, Snapshot } from "@ghosthand/protocol";
import { ok, Predicate } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { evaluateDoneWhen } from "./done-when.ts";
import { compileDoneWhen, compileExpectation } from "./expectations.ts";

const cases: Array<[string, unknown, boolean?]> = [
  ["The URL is /profile", { kind: "url", matches: "/profile" }],
  ["url contains ?saved=1", { kind: "url", matches: "/\\?saved=1/" }],
  ["user is redirected to /home", { kind: "url", matches: "/home" }],
  ['button "Save" is visible', { kind: "visible", role: "button", name: "Save" }],
  [
    'the dialog "Delete order" is not visible',
    { kind: "visible", role: "dialog", name: "Delete order" },
    true,
  ],
  ["heading 'Welcome, Alice' appears", { kind: "visible", role: "heading", name: "Welcome, Alice" }],
  ['the page shows a link "Sign out"', { kind: "visible", role: "link", name: "Sign out" }],
  ['text "Profile saved" is visible', { kind: "text", text: "Profile saved" }],
  ['"Invalid password" is not shown', { kind: "text", text: "Invalid password" }, true],
  ['no "Something went wrong" on the page', { kind: "text", text: "Something went wrong" }, true],
  ['the page says "Saved"', { kind: "text", text: "Saved" }],
  ['field "Display name" has value "Alice Ng"', { kind: "value", name: "Display name", value: "Alice Ng" }],
  ['input "Email" is filled', { kind: "value", name: "Email", value: "<filled>" }],
  ["GET /api/me returns 200", { kind: "http", method: "GET", url: "/api/me", status: 200 }],
  [
    'GET /api/me has user.name = "Alice Ng"',
    { kind: "http", method: "GET", url: "/api/me", path: "user.name", equals: "Alice Ng" },
  ],
  ["oracle l1-login passes", { kind: "oracle", taskId: "l1-login" }],
  [
    "The profile looks tidy and professional",
    { kind: "model", criteria: "The profile looks tidy and professional" },
  ],
];

describe("compileExpectation", () => {
  it.each(cases)("%s", (text, predicate, negated = false) => {
    const c = compileExpectation(text);
    expect(c.predicate).toEqual(predicate);
    expect(c.negated).toBe(negated);
    expect(Predicate.safeParse(c.predicate).success).toBe(true);
  });

  it("splits negated checks into none", () => {
    const d = compileDoneWhen([
      "url is /home",
      '"Invalid password" is not visible',
      "the avatar looks centred",
    ]);
    expect(d.all.map((p) => p.kind)).toEqual(["url", "model"]);
    expect(d.none).toEqual([{ kind: "text", text: "Invalid password" }]);
  });
});

const snap = (p: Partial<Snapshot> = {}): Snapshot => ({
  id: "s",
  surface: "web",
  takenAt: 0,
  url: "http://h/home",
  title: "",
  viewport: { x: 0, y: 0, width: 1, height: 1 },
  elements: [],
  text: "Welcome",
  tokenEstimate: 0,
  quality: { elementCount: 0, unnamedInteractive: 0, score: 1 },
  narrowed: false,
  ...p,
});

const decisionWith = (p: number): DecisionProvider => ({
  id: "fake",
  capabilities: { maxOptions: 255, maxLevels: 10, contextTokens: 64000, zdr: true },
  ask: async () =>
    ok({
      answers: { holds: { type: "noul", p } },
      model: "jev",
      provider: "fake",
      usage: { inputTokens: 100, outputTokens: 1 },
      costUsd: 0.000004,
      latencyMs: 1,
      calibration: "native",
    }),
});

describe("verify path (three-state, records who decided)", () => {
  it("uses the http checker for API predicates", async () => {
    const r = await evaluateDoneWhen(compileDoneWhen(["GET /api/me returns 200"]), snap(), {
      http: async () => true,
    });
    expect(r).toMatchObject({ state: "satisfied", decidedBy: "deterministic" });
    const missing = await evaluateDoneWhen(compileDoneWhen(["GET /api/me returns 200"]), snap());
    expect(missing.state).toBe("unknown");
  });

  it("decides by Jev when confident, by vision when Jev is inconclusive", async () => {
    const d = compileDoneWhen(["the welcome banner is friendly"]);
    const jev = await evaluateDoneWhen(d, snap(), { decision: decisionWith(0.92), state: {} });
    expect(jev).toMatchObject({ state: "satisfied", decidedBy: "decision", decisionCalls: 1 });
    const vision = await evaluateDoneWhen(d, snap(), {
      decision: decisionWith(0.5),
      state: {},
      vision: async () => ({ state: "unsatisfied", detail: "banner is cut off", costUsd: 0.002 }),
    });
    expect(vision).toMatchObject({ state: "unsatisfied", decidedBy: "vision" });
    expect(vision.costUsd).toBeCloseTo(0.002004);
    const unsure = await evaluateDoneWhen(d, snap(), { decision: decisionWith(0.5), state: {} });
    expect(unsure.state).toBe("unknown");
  });

  it("never asks a model when a deterministic check already fails", async () => {
    let asked = 0;
    const counting: DecisionProvider = {
      ...decisionWith(0.99),
      ask: async (...a) => {
        asked++;
        return decisionWith(0.99).ask(...a);
      },
    };
    const r = await evaluateDoneWhen(compileDoneWhen(["url is /profile", "it looks right"]), snap(), {
      decision: counting,
      state: {},
    });
    expect(r).toMatchObject({ state: "unsatisfied", decidedBy: "deterministic" });
    expect(asked).toBe(0);
  });
});
