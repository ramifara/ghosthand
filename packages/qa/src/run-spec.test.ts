// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The QA pipeline end to end with a fake executor: preflight → compile → loop events → judge → rubric →
// report. The planted-bug case must fail on the deterministic path without any model help.
import { HeuristicDecisionProvider } from "@ghosthand/core";
import {
  type Answer,
  type DecisionProvider,
  type Element,
  ok,
  type Questions,
  type RunEvent,
  type RunEventDraft,
  type Snapshot,
} from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import type { CaseExecution, CaseExecutor, ExecuteCaseInput } from "./case-execution.ts";
import { compileCase, compileQaExpect } from "./compile-spec.ts";
import { parseSpec } from "./parse-spec.ts";
import { preflightCase, quotedCount } from "./preflight.ts";
import { evaluateQaCheck, parseQaCheck } from "./qa-checks.ts";
import { RecordingDecisionProvider } from "./recording-decision.ts";
import { renderHtmlReport } from "./report-html.ts";
import { QaReport } from "./report-schema.ts";
import { passHatK } from "./rubric.ts";
import { runSpec } from "./run-spec.ts";
import type { VisionJudge } from "./vision-judge.ts";

const SPEC = `---
url: http://127.0.0.1:4400/profile
testbed:
  seed: 42
login: alice@testbed.local
budget:
  steps: 12
  seconds: 90
planted_bugs:
  profile-title: Update display name and job title
---
# Suite: Profile
## Case: Update display name and job title
1. **perform** Change the Display name to "Alice Moreau" and the Job title to "Staff Engineer", then save the profile.
   **expect** text "Profile saved." is visible
   **expect** field "Display name" has value "Alice Moreau"
   **expect** field "Job title" has value "Staff Engineer"
**expect** oracle l1-update-profile passes
**expect** no server errors
`;

function el(name: string, value?: string, role = "textbox"): Element {
  return {
    token: `e-${name}`,
    stableId: `s-${name}`,
    role,
    roleClass: role === "button" ? "button" : "textbox",
    nativeRole: "input",
    name,
    ...(value !== undefined ? { value } : {}),
    states: [],
    actions: ["set_value"],
    bounds: null,
    visibleBounds: null,
    boundsTrust: "none",
    region: "main",
    frame: "main",
    risk: "safe",
  };
}

function snap(text: string, elements: Element[]): Snapshot {
  return {
    id: `snap-${text.length}-${elements.length}`,
    surface: "web",
    takenAt: 1,
    url: "http://127.0.0.1:4400/profile",
    title: "Testbed",
    viewport: { x: 0, y: 0, width: 1280, height: 800 },
    elements,
    text,
    tokenEstimate: 100,
    quality: { elementCount: elements.length, unnamedInteractive: 0, score: 1 },
    narrowed: false,
  };
}

function events(drafts: RunEventDraft[]): RunEvent[] {
  return drafts.map((d, i) => ({ ...d, t: 1000 + i * 100, seq: i, runId: "run-1" }) as RunEvent);
}

/** Simulates the loop: the bug keeps the old title, so the value predicate never holds. */
function fakeExecutor(bug: boolean, seen: ExecuteCaseInput[] = []): CaseExecutor {
  return {
    async execute(input) {
      seen.push(input);
      const sg = input.task.plan?.subgoals[0];
      if (!sg) throw new Error("no subgoal");
      const title = bug ? "Engineer" : "Staff Engineer";
      const page = snap("Profile saved.", [el("Display name", "Alice Moreau"), el("Job title", title)]);
      const predicates = sg.doneWhen.all.map((p) => ({
        predicate: p,
        state: (p.kind === "value" && p.name === "Job title" && bug ? "unsatisfied" : "satisfied") as
          | "satisfied"
          | "unsatisfied",
      }));
      const ev = events([
        { type: "plan", plan: input.task.plan ?? { source: "task", subgoals: [sg] } },
        { type: "subgoal.start", subgoalId: sg.id, goal: sg.goal },
        {
          type: "observe",
          step: 1,
          snapshotId: "s1",
          elementCount: 2,
          tokenEstimate: 10,
          screenshot: "screenshots/step-001.png",
        },
        { type: "decision.answer", step: 1, model: "fake", latencyMs: 1, costUsd: 0.0001, inputTokens: 500 },
        {
          type: "step.end",
          step: 1,
          mode: "B",
          timing: { settleMs: 1, observeMs: 1, decideMs: 1, actMs: 1, verifyMs: 1 },
        },
        {
          type: "verify",
          step: 2,
          state: bug ? "unsatisfied" : "satisfied",
          decidedBy: "deterministic",
          predicates,
        },
        { type: "subgoal.end", subgoalId: sg.id, state: bug ? "unsatisfied" : "satisfied", steps: 3 },
        {
          type: "run.end",
          outcome: bug ? "stuck" : "success",
          reason: bug ? "3 consecutive refusals" : "all subgoals done",
          steps: 3,
          wallMs: 4000,
          costUsd: 0.0003,
          decisionCalls: 3,
          modelCalls: 0,
          modeShares: { B: 1 },
        },
      ]);
      const exec: CaseExecution = {
        runId: "run-1",
        folder: "/tmp/run-1",
        outcome: bug ? "stuck" : "success",
        reason: bug ? "3 consecutive refusals" : "all subgoals done",
        events: ev,
        checkpoints: {
          [sg.id]: {
            snapshot: page,
            screenshot: new Uint8Array([7]),
            screenshotFile: "screenshots/step-001.png",
            thumbnail: new Uint8Array([1, 2, 3]),
          },
        },
        final: { snapshot: page, screenshot: new Uint8Array([9]) },
        errors: { consoleErrors: [], httpErrors: [] },
        a11y: [
          {
            url: "http://127.0.0.1:4400/profile",
            violations: [
              { id: "color-contrast", impact: "serious", help: "contrast", helpUrl: "https://x", nodes: 2 },
            ],
          },
        ],
        holds: [],
        wallMs: 4000,
        steps: 3,
        costUsd: 0.0003,
        decisionCalls: 3,
        modelCalls: 0,
        inputTokens: 1500,
        checks: { oracle: async (id) => (id === "l1-update-profile" ? !bug : undefined) },
      };
      return ok(exec);
    },
  };
}

const parsed = parseSpec(SPEC, "profile.md");
if (!parsed.ok) throw new Error(parsed.error.message);
const spec = parsed.value;

describe("compile", () => {
  it("builds one subgoal per step with compiled expects", () => {
    const c = compileCase(spec, spec.suites[0]?.cases[0] ?? never(), "case-1");
    expect(c.task.mode).toBe("test");
    expect(c.task.plan?.subgoals.map((s) => s.id)).toEqual(["step-1"]);
    expect(c.task.plan?.subgoals[0]?.doneWhen.all).toEqual([
      { kind: "text", text: "Profile saved." },
      { kind: "value", name: "Display name", value: "Alice Moreau" },
      { kind: "value", name: "Job title", value: "Staff Engineer" },
    ]);
    expect(c.task.plan?.subgoals[0]?.allowedEffects).toEqual(["advance", "commit"]);
    expect(c.expects.map((e) => e.kind)).toEqual(["loop", "qa"]);
    expect(c.task.allowOrigins).toEqual(["http://127.0.0.1:4400"]);
  });

  it("routes visual model claims to vision and keeps http checks out of the loop", () => {
    expect(compileQaExpect({ text: "the logo is centred in the header", line: 3 }, "visual").kind).toBe(
      "vision",
    );
    expect(compileQaExpect({ text: "GET /api/me returns 200", line: 3 }).kind).toBe("http");
    expect(compileQaExpect({ text: "3 rows are visible", line: 3 }).kind).toBe("qa");
    expect(compileQaExpect({ text: 'the "Save" button is disabled', line: 3 }).kind).toBe("qa");
  });
});

describe("qa checks", () => {
  it("parses and evaluates title, count, state, console and server checks", () => {
    const page = snap("x", [el("Save", undefined, "button"), el("Name", "A")]);
    const check = (t: string) => {
      const c = parseQaCheck(t);
      if (!c) throw new Error(`not a check: ${t}`);
      const r = evaluateQaCheck(c.check, page, {
        consoleErrors: ["boom"],
        httpErrors: [{ status: 502, url: "/api" }],
      });
      return c.negated ? (r.state === "satisfied" ? "unsatisfied" : "satisfied") : r.state;
    };
    expect(check('the page title is "Testbed"')).toBe("satisfied");
    expect(check("1 buttons are visible")).toBe("satisfied");
    expect(check("at least 2 buttons are visible")).toBe("unsatisfied");
    expect(check('the "Save" button is disabled')).toBe("unsatisfied");
    expect(check('the "Save" button is not disabled')).toBe("satisfied");
    expect(check("no console errors")).toBe("unsatisfied");
    expect(check("no server errors")).toBe("unsatisfied");
    expect(parseQaCheck('text "x" is visible')).toBeUndefined();
  });
});

describe("preflight", () => {
  it("asks one request per case with flag and count heads and maps the answers", async () => {
    const asked: Questions[] = [];
    const provider: DecisionProvider = {
      id: "fake",
      capabilities: { maxOptions: 255, maxLevels: 10, contextTokens: 64_000, zdr: true },
      async ask(_state, questions) {
        asked.push(questions);
        const pick = (choice: string): Answer => ({
          type: "choice",
          choice,
          confidence: 0.9,
          probabilities: { [choice]: 0.9 },
        });
        return ok({
          answers: { flag1: pick("visual"), count1: pick("3") },
          model: "fake",
          provider: "fake",
          usage: { inputTokens: 200, outputTokens: 0 },
          costUsd: 0.00001,
          latencyMs: 5,
          calibration: "native",
        });
      },
    };
    const pre = await preflightCase(spec.suites[0]?.cases[0] ?? never(), provider);
    expect(asked).toHaveLength(1);
    expect(Object.keys(asked[0] ?? {})).toEqual(["flag1", "count1"]);
    expect(pre.steps).toEqual([{ flag: "visual", actions: 3, confidence: 0.9, answered: true }]);
    expect(quotedCount('Type "a" and "b"')).toBe(3);
  });
});

describe("runSpec", () => {
  it("passes the case without the bug and scores the rubric", async () => {
    const report = await runSpec({
      spec,
      executor: fakeExecutor(false),
      decision: () => new HeuristicDecisionProvider(),
    });
    expect(QaReport.safeParse(report).success).toBe(true);
    expect(report.verdict).toBe("PASS");
    const step = report.cases[0]?.runs[0]?.steps[0];
    expect(step?.status).toBe("passed");
    expect(step?.decidedBy).toBe("deterministic");
    expect(step?.evidence.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    expect(report.cases[0]?.runs[0]?.caseExpects.map((e) => [e.state, e.decidedBy])).toEqual([
      ["satisfied", "oracle"],
      ["satisfied", "deterministic"],
    ]);
    expect(report.plantedBugs).toEqual([
      {
        flag: "profile-title",
        active: false,
        expectedCase: "Update display name and job title",
        caughtRuns: 0,
        runs: 1,
        caught: false,
      },
    ]);
    const success = report.rubric.find((r) => r.key === "success");
    expect(success?.points).toBe(40);
    expect(report.rubric.find((r) => r.key === "ux")?.points).toBeUndefined(); // heuristic abstains on scores
    expect(report.rubric.find((r) => r.key === "accessibility")?.points).toBe(8.5);
    expect(report.score).toBeGreaterThan(80);
  });

  it("fails the planted-bug case on the deterministic path, over N runs", async () => {
    const seen: ExecuteCaseInput[] = [];
    const report = await runSpec({
      spec,
      executor: fakeExecutor(true, seen),
      decision: () => new HeuristicDecisionProvider(),
      runs: 3,
      variant: { bug: "profile-title" },
    });
    expect(seen).toHaveLength(3);
    expect(report.verdict).toBe("FAIL");
    const run = report.cases[0]?.runs[0];
    expect(run?.steps[0]?.status).toBe("failed");
    expect(run?.steps[0]?.decidedBy).toBe("deterministic");
    expect(run?.steps[0]?.detail).toContain('field "Job title" has value "Staff Engineer"');
    expect(run?.caseExpects[0]).toMatchObject({ state: "unsatisfied", decidedBy: "oracle" });
    expect(report.plantedBugs[0]).toMatchObject({
      active: true,
      caught: true,
      caughtRuns: 3,
      runs: 3,
      decidedBy: "deterministic",
    });
    expect(report.rubric.find((r) => r.key === "success")?.points).toBe(0);
    expect(report.summaryLine).toMatch(/^\[qa\] verdict FAIL: 0 of 3 decisive steps passed; failed: /);
    const html = renderHtmlReport(report);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).not.toContain("<script");
    expect(html).toContain("caught");
    expect(html).toContain("data:image/jpeg;base64,");
  });

  it("sends model claims through Jev, then vision, then inconclusive", async () => {
    const md = SPEC.replace(
      '**expect** text "Profile saved." is visible',
      "**expect** the page looks calm and friendly",
    );
    const p = parseSpec(md);
    if (!p.ok) throw new Error(p.error.message);
    const vision: VisionJudge = {
      id: "fake-vision",
      check: async ({ criteria }) =>
        ok({
          verdicts: criteria.map(() => ({
            state: "satisfied" as const,
            confidence: 0.8,
            detail: "looks calm",
          })),
          model: "v",
          costUsd: 0.01,
          latencyMs: 1,
        }),
      rate: async () => ok({ score: 0.9, issues: [], model: "v", costUsd: 0.01, latencyMs: 1 }),
    };
    // Executor where the model predicate stays unknown in the loop (heuristic holds = 0.5).
    const base = fakeExecutor(false);
    const executor: CaseExecutor = {
      async execute(input) {
        const r = await base.execute(input);
        if (!r.ok) return r;
        for (const e of r.value.events)
          if (e.type === "verify")
            for (const pr of e.predicates) if (pr.predicate.kind === "model") pr.state = "unknown";
        return r;
      },
    };
    const withVision = await runSpec({
      spec: p.value,
      executor,
      decision: () => new HeuristicDecisionProvider(),
      vision,
    });
    const exp = withVision.cases[0]?.runs[0]?.steps[0]?.expects[0];
    expect(exp).toMatchObject({ state: "satisfied", decidedBy: "vision" });
    expect(exp?.detail).toContain("jev holds p=0.50");
    expect(withVision.rubric.find((r) => r.key === "visual")?.points).toBe(4.5);
    const without = await runSpec({
      spec: p.value,
      executor,
      decision: () => new HeuristicDecisionProvider(),
    });
    expect(without.cases[0]?.runs[0]?.steps[0]?.status).toBe("inconclusive");
    expect(without.verdict).toBe("INCONCLUSIVE");
  });

  it("marks steps after a failed launch as blocked", async () => {
    const report = await runSpec({
      spec,
      executor: { execute: async () => ({ ok: false, error: { kind: "setup", message: "testbed down" } }) },
      decision: () => new HeuristicDecisionProvider(),
    });
    expect(report.verdict).toBe("BLOCKED");
    expect(report.cases[0]?.runs[0]?.steps[0]?.status).toBe("blocked");
  });
});

describe("rubric maths", () => {
  it("computes pass^k", () => {
    expect(passHatK(5, 5)).toBe(1);
    expect(passHatK(4, 5)).toBe(0);
    expect(passHatK(4, 5, 1)).toBeCloseTo(0.8);
    expect(passHatK(4, 5, 2)).toBeCloseTo(0.6);
  });
});

describe("RecordingDecisionProvider", () => {
  it("keeps holds probabilities per subgoal and totals tokens", async () => {
    const rec = new RecordingDecisionProvider(new HeuristicDecisionProvider());
    rec.subgoalId = "step-1";
    await rec.ask(
      {},
      {
        holds: {
          type: "noul",
          instructions: 'Does this condition hold on the current page: "it saved"? Judge.',
        },
      },
    );
    expect(rec.holds).toEqual([
      { subgoalId: "step-1", criteria: "it saved", p: 0.5, costUsd: 0, inputTokens: 1 },
    ]);
    expect(rec.calls).toBe(1);
  });
});

function never(): never {
  throw new Error("missing fixture");
}
