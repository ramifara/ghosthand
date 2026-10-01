// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { Element, Snapshot } from "@ghosthand/protocol";
import { MAX_CHOICE_OPTIONS, Question } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { BudgetTracker } from "./budget.ts";
import { buildCandidates, MAX_CANDIDATES_PER_HEAD } from "./candidates.ts";
import { evaluateDeterministic, evaluateDoneWhen, urlMatches } from "./done-when.ts";
import { allPassed, combineEffect, evaluateGates } from "./gates.ts";
import { buildTextOptions, extractLiterals } from "./literals.ts";
import { ANTI_INJECTION, buildActQuestions, optionQuestions } from "./questions.ts";
import { SecretsRegistry } from "./secrets.ts";
import { StallDetector } from "./stall.ts";
import { buildState, estimateTokens } from "./state-builder.ts";

const el = (token: string, p: Partial<Element> = {}): Element => ({
  token,
  stableId: `id-${token}`,
  role: "button",
  roleClass: "button",
  nativeRole: "button",
  name: `Button ${token}`,
  states: [],
  actions: ["press"],
  bounds: null,
  visibleBounds: null,
  boundsTrust: "none",
  region: "main",
  frame: "main",
  risk: "safe",
  ...p,
});

const snap = (elements: Element[], p: Partial<Snapshot> = {}): Snapshot => ({
  id: "s1",
  surface: "web",
  takenAt: 0,
  url: "http://127.0.0.1:4400/login",
  title: "Sign in",
  viewport: { x: 0, y: 0, width: 1, height: 1 },
  elements,
  text: "",
  tokenEstimate: 0,
  quality: { elementCount: elements.length, unnamedInteractive: 0, score: 1 },
  narrowed: false,
  ...p,
});

describe("SecretsRegistry", () => {
  it("redacts registered values in text and nested values, and sensitive keys", () => {
    const r = new SecretsRegistry([["PW", "hunter22"]]);
    expect(r.redact("pw is hunter22!")).toBe("pw is [input:PW]!");
    expect(r.redactValue({ a: ["x hunter22"], password: "anything", token: "e12" })).toEqual({
      a: ["x [input:PW]"],
      password: "[redacted]",
      token: "e12",
    });
    expect(r.match("hunter22")).toBe("PW");
    expect(() => r.register("bad name", "x")).toThrow();
  });
});

describe("literals", () => {
  it("extracts quoted strings, emails and numbers in order", () => {
    expect(extractLiterals(`Sign in as alice@testbed.local and set the name to "Alice Ng", age 42`)).toEqual([
      "alice@testbed.local",
      "Alice Ng",
      "42",
    ]);
  });
  it("never offers a registered secret as a literal", () => {
    const r = new SecretsRegistry([["PW", "s3cret-pw"]]);
    const opts = buildTextOptions(`type "s3cret-pw" and "hello"`, ["PW"], r);
    expect(opts.map((o) => o.key)).toEqual(["lit_1", "sec_1"]);
    expect(JSON.stringify(opts)).not.toContain("s3cret-pw");
  });
});

describe("candidates", () => {
  it("ranks dialog first, drops disabled, restricts to the dialog when open, caps per head", () => {
    const s = snap([
      el("e1"),
      el("e2", { region: "dialog" }),
      el("e3", { states: ["disabled"], region: "dialog" }),
    ]);
    const c = buildCandidates(s);
    expect(c.press.map((e) => e.token)).toEqual(["e2"]);
    const many = snap(Array.from({ length: 300 }, (_, i) => el(`e${i}`)));
    expect(buildCandidates(many).press).toHaveLength(MAX_CANDIDATES_PER_HEAD);
  });
  it("ranks tried elements last", () => {
    const c = buildCandidates(snap([el("e1"), el("e2")]), { triedHere: new Set(["id-e1"]) });
    expect(c.press.map((e) => e.token)).toEqual(["e2", "e1"]);
  });
});

describe("question builders", () => {
  const s = snap([
    el("e1", { role: "textbox", roleClass: "textbox", name: "Email", actions: ["set_value"] }),
    el("e2", { name: "Sign in" }),
  ]);
  const built = buildActQuestions({
    candidates: buildCandidates(s),
    textOptions: buildTextOptions("Sign in as a@b.co", ["PW"]),
  });

  it("offers only operations with candidates, with sentinels, and never a 1-option choice", () => {
    expect(built.offered).toEqual(["press", "set_value"]);
    expect(Object.keys(built.questions)).toEqual([
      "operation",
      "press_target",
      "set_value_target",
      "text",
      "effect",
      "goal_done",
      "stuck",
    ]);
    for (const q of Object.values(built.questions)) {
      expect(Question.safeParse(q).success).toBe(true);
      if (q.type === "choice") {
        const n = Object.keys(q.criteria).length;
        expect(n).toBeGreaterThanOrEqual(2);
        expect(n).toBeLessThanOrEqual(MAX_CHOICE_OPTIONS);
      }
      expect(String(q.instructions)).toContain(ANTI_INJECTION);
    }
    expect(Object.keys((built.questions.press_target as { criteria: object }).criteria)).toEqual([
      "e2",
      "none",
      "ambiguous",
    ]);
  });

  it("caps target heads at 255 options including sentinels", () => {
    const many = snap(Array.from({ length: 300 }, (_, i) => el(`e${i}`)));
    const q = buildActQuestions({
      candidates: { ...buildCandidates(many), press: many.elements },
      textOptions: [],
    });
    expect(Object.keys((q.questions.press_target as { criteria: object }).criteria)).toHaveLength(255);
  });

  it("asks still-valid questions when no element is actionable", () => {
    const q = buildActQuestions({ candidates: buildCandidates(snap([])), textOptions: [] });
    expect(Object.keys((q.questions.operation as { criteria: object }).criteria)).toEqual([
      "wait",
      "blocked",
    ]);
  });

  it("partitions long option lists into chunks of 64", () => {
    const sel = el("e9", { role: "combobox", options: Array.from({ length: 130 }, (_, i) => `Opt ${i}`) });
    const qs = optionQuestions(sel, "pick Opt 100");
    expect(Object.keys(qs)).toEqual(["option_0", "option_1", "option_2"]);
    expect(Object.keys((qs.option_2 as { criteria: object }).criteria)).toEqual(["o128", "o129", "none"]);
  });
});

describe("state builder", () => {
  it("has a stable key order, keeps history to 8 entries and redacts secrets", () => {
    const r = new SecretsRegistry([["PW", "hunter22"]]);
    const state = buildState(
      {
        instruction: "log in",
        goal: "log in",
        step: 9,
        phase: "act",
        snapshot: snap([el("e1")], { text: "your password hunter22 is weak" }),
        history: Array.from({ length: 12 }, (_, i) => ({ step: i + 1, text: `did ${i + 1}` })),
        inputs: ["PW"],
      },
      r,
    );
    expect(Object.keys(state)).toEqual(["task", "page", "elements", "texts", "inputs", "history"]);
    expect(state.history).toHaveLength(8);
    expect(JSON.stringify(state)).not.toContain("hunter22");
    expect(estimateTokens(state)).toBeGreaterThan(10);
  });
});

describe("gates", () => {
  const choice = (choice: string, p: number) => ({
    type: "choice" as const,
    choice,
    confidence: p,
    probabilities: { [choice]: p, other: 1 - p },
  });
  it("passes a confident, named, allowed action", () => {
    const g = evaluateGates({
      thresholds: { operation: 0.65, target: 0.7 },
      operation: choice("press", 0.9),
      target: choice("e1", 0.8),
      element: el("e1"),
      effect: "advance",
      allowedEffects: ["advance"],
      snapshotFresh: true,
    });
    expect(allPassed(g)).toBe(true);
  });
  it("refuses low confidence, unnamed targets and disallowed effects", () => {
    const g = evaluateGates({
      thresholds: { operation: 0.65, target: 0.7 },
      operation: choice("press", 0.5),
      target: choice("e1", 0.69),
      element: el("e1", { name: " " }),
      effect: "commit",
      allowedEffects: ["advance"],
      snapshotFresh: true,
    });
    expect(g.filter((x) => !x.passed).map((x) => x.gate)).toEqual([
      "operation_confidence",
      "target_confidence",
      "target_named",
      "effect_allowed",
    ]);
  });
  it("takes the stricter of code and model effect", () => {
    expect(combineEffect(el("e1", { risk: "destructive" }), "advance")).toBe("commit");
    expect(combineEffect(el("e1"), "forbidden")).toBe("forbidden");
    expect(combineEffect(el("e1"), undefined)).toBe("advance");
  });
});

describe("stall detection", () => {
  it("flags three unchanged screens", () => {
    const s = new StallDetector();
    for (let i = 0; i < 4; i++) s.observe("same");
    expect(s.verdict()).toMatchObject({ stalled: true, noChangeSteps: 3 });
  });
  it("flags the same action repeated on the same screen", () => {
    const s = new StallDetector();
    s.observe("a");
    s.attempt("press|x");
    s.attempt("press|x");
    expect(s.verdict().stalled).toBe(false);
    s.attempt("press|x");
    expect(s.verdict()).toMatchObject({ stalled: true, repeats: 2 });
  });
  it("detects cycles", () => {
    const s = new StallDetector();
    for (const x of ["a", "b", "c", "a"]) s.observe(x);
    expect(s.verdict().cycle).toBe(true);
  });
});

describe("budgets", () => {
  it("stops on steps, time and dollars", () => {
    let now = 0;
    const b = new BudgetTracker({ steps: 2, seconds: 10, usd: 0.01 }, { now: () => now });
    expect(b.exceeded()).toBeUndefined();
    b.step();
    b.step();
    expect(b.exceeded()?.kind).toBe("steps");
    const t = new BudgetTracker({ steps: 9, seconds: 10, usd: 0.01 }, { now: () => now });
    now = 10_000;
    expect(t.exceeded()?.kind).toBe("time");
    const u = new BudgetTracker({ steps: 9, seconds: 99, usd: 0.01 }, { now: () => now });
    u.spend(0.02);
    expect(u.exceeded()?.kind).toBe("usd");
  });
});

describe("done_when", () => {
  it("matches URLs by path, glob, regex and prefix", () => {
    expect(urlMatches("http://h/profile/", "/profile")).toBe(true);
    expect(urlMatches("http://h/profile/edit", "/profile")).toBe(false);
    expect(urlMatches("http://h/orders/12", "/orders/*")).toBe(true);
    expect(urlMatches("http://h/a?x=1", "/x=1/")).toBe(true);
    expect(urlMatches("http://h/a", "http://h/")).toBe(true);
  });
  it("evaluates visible, text and value predicates on the snapshot", () => {
    const s = snap([el("e1", { role: "textbox", name: "Email", value: "<filled>" })], {
      text: "Profile saved",
    });
    expect(evaluateDeterministic({ kind: "text", text: "profile SAVED" }, s)).toBe("satisfied");
    expect(evaluateDeterministic({ kind: "visible", name: "Email", role: "textbox" }, s)).toBe("satisfied");
    expect(evaluateDeterministic({ kind: "value", name: "Email", value: "<filled>" }, s)).toBe("satisfied");
    expect(evaluateDeterministic({ kind: "visible", name: "Nope" }, s)).toBe("unsatisfied");
  });
  it("lets a none-predicate veto and falls back to the oracle", async () => {
    const s = snap([], { text: "Invalid password", url: "http://h/home" });
    const vetoed = await evaluateDoneWhen(
      { all: [{ kind: "url", matches: "/home" }], none: [{ kind: "text", text: "invalid password" }] },
      s,
    );
    expect(vetoed.state).toBe("unsatisfied");
    const viaOracle = await evaluateDoneWhen({ all: [{ kind: "oracle", taskId: "t" }], none: [] }, s, {
      oracle: async () => true,
    });
    expect(viaOracle).toMatchObject({ state: "satisfied", decidedBy: "oracle" });
  });
});
