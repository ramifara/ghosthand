// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLoginComputer, type Recording, ScriptedDecisionProvider } from "@ghosthand/core";
import { TaskSpec } from "@ghosthand/protocol";
import { actionsForReplay, readRun } from "@ghosthand/recorder";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config-loader.ts";
import { loadEnvFile, parseEnv } from "./env-file.ts";
import { exportPlaywrightSpec } from "./export-spec.ts";
import { type ComputerLauncher, runAgent, runReplay } from "./run-agent.ts";
import { openRuntime } from "./runtime.ts";

const recording = JSON.parse(
  readFileSync(new URL("./__recordings__/l1-login.json", import.meta.url), "utf8"),
) as Recording;
const PASSWORD = "correct-horse-7";

const task = TaskSpec.parse({
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

async function runtime() {
  const dir = mkdtempSync(join(tmpdir(), "gh-engine-"));
  const envPath = join(dir, "env");
  writeFileSync(envPath, `TESTBED_PASSWORD=${PASSWORD}\nTYPESAFE_API_KEY=ts-test-key-123\n`, { mode: 0o600 });
  const rt = await openRuntime({
    cwd: dir,
    envFilePath: envPath,
    overrides: { runsDir: join(dir, "runs") },
    logLevel: "silent",
  });
  if (!rt.ok) throw new Error(rt.error.message);
  return { rt: rt.value, dir };
}

function launcher(rt: Awaited<ReturnType<typeof runtime>>["rt"]): {
  launch: ComputerLauncher;
  computers: FakeLoginComputer[];
} {
  const computers: FakeLoginComputer[] = [];
  return {
    computers,
    launch: async () => {
      const computer = new FakeLoginComputer({
        email: "alice@testbed.local",
        passwordSecret: "TESTBED_PASSWORD",
        secrets: rt.secrets,
      });
      computers.push(computer);
      return { ok: true, value: { computer, surface: "fake", close: async () => {} } };
    },
  };
}

describe("env file and config", () => {
  it("parses KEY=VALUE lines with comments, export and quotes", () => {
    const m = parseEnv("# c\nexport A=1\nB=\"two words\"\nC='3'\nbad line\n");
    expect([...m]).toEqual([
      ["A", "1"],
      ["B", "two words"],
      ["C", "3"],
    ]);
  });
  it("flags an env file readable by others", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-env-"));
    const p = join(dir, "env");
    writeFileSync(p, "A=1\n", { mode: 0o644 });
    const r = loadEnvFile(p);
    expect(r.ok && r.value.insecure).toBe(process.platform !== "win32");
  });
  it("loads ghosthand.config.ts and validates it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-cfg-"));
    writeFileSync(join(dir, "ghosthand.config.ts"), "export const config = { gates: { target: 0.8 } };\n");
    const r = await loadConfig({ cwd: dir });
    expect(r.ok && r.value.gates.target).toBe(0.8);
    writeFileSync(join(dir, "bad.config.ts"), "export const config = { gates: { target: 7 } };\n");
    const bad = await loadConfig({ cwd: dir, path: "bad.config.ts" });
    expect(bad.ok).toBe(false);
  });
});

describe("runAgent + replay (fake computer, recorded decisions)", () => {
  it("records a run folder, indexes it, keeps secrets out, and replays with zero decision calls", async () => {
    const { rt } = await runtime();
    const { launch, computers } = launcher(rt);
    const decision = new ScriptedDecisionProvider(recording);
    const run = await runAgent(rt, {
      task,
      launch,
      decision,
      hooks: { oracle: async () => computers.at(-1)?.loggedIn },
    });
    if (!run.ok) throw new Error(run.error);
    expect(run.value.outcome).toBe("success");
    expect(run.value.oraclePass).toBe(true);
    const files = readdirSync(run.value.folder);
    for (const f of ["events.jsonl", "summary.json", "log.jsonl", "otel.jsonl"]) expect(files).toContain(f);
    expect(readdirSync(join(run.value.folder, "screenshots")).length).toBeGreaterThan(0);
    for (const f of ["events.jsonl", "summary.json", "log.jsonl", "otel.jsonl"]) {
      expect(readFileSync(join(run.value.folder, f), "utf8")).not.toContain(PASSWORD);
    }
    const spans = readFileSync(join(run.value.folder, "otel.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { name: string });
    expect(spans.map((s) => s.name)).toEqual(expect.arrayContaining(["run", "subgoal", "step", "decision"]));
    const listed = rt.index.listRuns({ limit: 5 });
    expect(listed.ok && listed.value[0]?.id).toBe(run.value.runId);

    const log = readRun(run.value.runId, { runsDir: rt.runsDir });
    if (!log.ok) throw new Error(log.error.message);
    const steps = actionsForReplay(log.value.events).map((a) => ({
      step: a.step,
      action: a.action,
      target: a.target ?? null,
    }));
    expect(steps).toHaveLength(3);
    const replay = await runReplay(rt, {
      task,
      steps,
      launch,
      replayOf: run.value.runId,
      hooks: { oracle: async () => computers.at(-1)?.loggedIn },
    });
    if (!replay.ok) throw new Error(replay.error);
    expect(replay.value.outcome).toBe("success");
    expect(replay.value.result.decisionCalls).toBe(0);
    expect(computers.at(-1)?.actions).toEqual(["set_value e3", "set_value e4", "press e5"]);
    expect(existsSync(join(replay.value.folder, "events.jsonl"))).toBe(true);
  });
});

describe("replay v1: healing and spec export", () => {
  it("heals a renamed button with one Jev call and exports a Playwright spec", async () => {
    const { rt } = await runtime();
    const { launch } = launcher(rt);
    const run = await runAgent(rt, { task, launch, decision: new ScriptedDecisionProvider(recording) });
    if (!run.ok) throw new Error(run.error);
    const log = readRun(run.value.runId, { runsDir: rt.runsDir });
    if (!log.ok) throw new Error(log.error.message);
    const steps = actionsForReplay(log.value.events).map((a) => ({
      step: a.step,
      action: a.action,
      target: a.target ?? null,
    }));

    let moved: FakeLoginComputer | undefined;
    const movedLaunch: ComputerLauncher = async () => {
      moved = new FakeLoginComputer({
        email: "alice@testbed.local",
        passwordSecret: "TESTBED_PASSWORD",
        secrets: rt.secrets,
        submitLabel: "Log in",
      });
      return { ok: true, value: { computer: moved, surface: "fake", close: async () => {} } };
    };
    const noHeal = await runReplay(rt, { task, steps, launch: movedLaunch, replayOf: run.value.runId });
    expect(noHeal.ok && noHeal.value.outcome).toBe("failure");

    const healer = new ScriptedDecisionProvider({
      model: "jev-1.13.0",
      calls: [
        {
          answers: {
            same_control: {
              type: "choice",
              choice: "e5",
              confidence: 0.93,
              probabilities: { e5: 0.93, e3: 0.02, e4: 0.02, none: 0.03 },
            },
          },
          usage: { inputTokens: 300, outputTokens: 5 },
          latencyMs: 190,
        },
      ],
    });
    const healed = await runReplay(rt, {
      task,
      steps,
      launch: movedLaunch,
      replayOf: run.value.runId,
      decision: healer,
    });
    if (!healed.ok) throw new Error(healed.error);
    expect(healed.value.outcome).toBe("success");
    expect(healed.value.result).toMatchObject({ decisionCalls: 1, heals: 1 });
    expect(moved?.loggedIn).toBe(true);

    const spec = exportPlaywrightSpec(task, steps);
    expect(spec).toContain(
      'page.getByRole("button" as Parameters<Page["getByRole"]>[0], { name: "Sign in", exact: true })',
    );
    expect(spec).toContain('process.env["TESTBED_PASSWORD"]');
    expect(spec).toContain('.fill("alice@testbed.local")');
    expect(spec).toContain("toHaveURL");
    expect(spec).not.toContain(PASSWORD);
  });
});
