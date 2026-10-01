// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLoginComputer, type Recording, ScriptedDecisionProvider } from "@ghosthand/core";
import { openRuntime, type PreparedTestbedRun } from "@ghosthand/engine";
import { TaskSpec } from "@ghosthand/protocol";
import { createControlClient, l1Login } from "@ghosthand/testbed-kit";
import { describe, expect, it } from "vitest";
import { runSuite } from "./run-suite.ts";
import { selectTasks } from "./suites.ts";
import { median, percentile, summarize } from "./summarize.ts";

const recording = JSON.parse(
  readFileSync(new URL("./__recordings__/l1-login.json", import.meta.url), "utf8"),
) as Recording;
const PASSWORD = "correct-horse-7";

describe("suites", () => {
  it("selects by level and rejects unknown suites", () => {
    const s = selectTasks("l1");
    expect(s.ok && s.value.every((t) => t.level <= 1)).toBe(true);
    expect(selectTasks("nope").ok).toBe(false);
    const only = selectTasks("l1", { only: ["l1-login"] });
    expect(only.ok && only.value.map((t) => t.id)).toEqual(["l1-login"]);
  });
});

describe("summary maths", () => {
  it("computes medians and percentiles", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
  });
});

describe("runSuite", () => {
  it("runs N attempts, lets the oracle decide pass, and writes results and a Markdown table", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-evals-"));
    const env = join(dir, "env");
    writeFileSync(env, "", { mode: 0o600 });
    const rt = await openRuntime({
      cwd: dir,
      envFilePath: env,
      overrides: { runsDir: join(dir, "runs") },
      logLevel: "silent",
    });
    if (!rt.ok) throw new Error(rt.error.message);
    let computer: FakeLoginComputer | undefined;
    const spec = TaskSpec.parse({
      id: "l1-login",
      instruction: "Sign in as alice@testbed.local with the stored password",
      startUrl: "http://127.0.0.1:4400/login",
      secrets: ["TESTBED_PASSWORD"],
      plan: {
        source: "task",
        subgoals: [
          {
            id: "login",
            goal: "Sign in as alice@testbed.local with the stored password",
            doneWhen: { all: [{ kind: "url", matches: "/home" }], none: [] },
            allowedEffects: ["advance", "commit"],
          },
        ],
      },
    });
    let attempt = 0;
    const report = await runSuite(rt.value, {
      suite: "smoke",
      n: 2,
      outDir: join(dir, "out"),
      decision: () => new ScriptedDecisionProvider(recording),
      prepare: async (): Promise<{ ok: true; value: PreparedTestbedRun }> => ({
        ok: true,
        value: {
          task: l1Login,
          spec,
          cookies: [],
          secrets: { TESTBED_PASSWORD: PASSWORD },
          control: createControlClient(),
          // Second attempt: the oracle disagrees with the agent, and the oracle wins.
          oracle: async () => (attempt === 2 ? false : computer?.loggedIn),
        },
      }),
      launcherFor: () => async () => {
        attempt++;
        computer = new FakeLoginComputer({
          email: "alice@testbed.local",
          passwordSecret: "TESTBED_PASSWORD",
          secrets: rt.value.secrets,
        });
        return { ok: true, value: { computer, surface: "fake", close: async () => {} } };
      },
    });
    if (!report.ok) throw new Error(report.error.message);
    expect(report.value.rows.map((r) => [r.outcome, r.pass])).toEqual([
      ["success", true],
      ["success", false],
    ]);
    expect(report.value.summary.passes).toBe(1);
    expect(report.value.summary.decisionCalls).toBe(6);
    expect(report.value.summary.llmShare).toBe(0);
    expect(report.value.markdown).toContain("| `l1-login@1` | 1/2 |");
    const lines = readFileSync(join(report.value.outDir, "results.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.join("\n")).not.toContain(PASSWORD);
    expect(summarize(report.value.rows).modeShares).toEqual({ B: 1 });
  });
});
