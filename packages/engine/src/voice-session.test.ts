// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLoginComputer, HeuristicDecisionProvider } from "@ghosthand/core";
import type { ActionResult, RunEvent } from "@ghosthand/protocol";
import { actionsForReplay, parseEvents } from "@ghosthand/recorder";
import type { SttResult } from "@ghosthand/voice";
import { describe, expect, it } from "vitest";
import type { ComputerLauncher } from "./run-agent.ts";
import { type EngineRuntime, openRuntime } from "./runtime.ts";
import { openVoiceSession, runVoiceCommand, type VoiceConfirmRequest } from "./voice-session.ts";

const PASSWORD = "voice-test-pw-123";

async function runtime(): Promise<EngineRuntime> {
  const dir = mkdtempSync(join(tmpdir(), "gh-voice-"));
  const envPath = join(dir, "env");
  writeFileSync(envPath, `TESTBED_PASSWORD=${PASSWORD}\n`, { mode: 0o600 });
  const rt = await openRuntime({
    cwd: dir,
    envFilePath: envPath,
    overrides: { runsDir: join(dir, "runs") },
    logLevel: "silent",
  });
  if (!rt.ok) throw new Error(rt.error.message);
  return rt.value;
}

/** FakeLoginComputer with an optional slow press, to test "stop". */
class SlowLogin extends FakeLoginComputer {
  pressDelayMs = 0;
  override async press(token: string): Promise<ActionResult> {
    if (this.pressDelayMs) await new Promise((r) => setTimeout(r, this.pressDelayMs));
    return super.press(token);
  }
}

function launcher(rt: EngineRuntime) {
  const computers: SlowLogin[] = [];
  const launch: ComputerLauncher = async () => {
    const computer = new SlowLogin({
      email: "alice@testbed.local",
      passwordSecret: "TESTBED_PASSWORD",
      secrets: rt.secrets,
    });
    computers.push(computer);
    return { ok: true, value: { computer, surface: "fake", close: async () => {} } };
  };
  return { launch, computers };
}

const stt = (text: string): SttResult => ({
  text,
  latencyMs: 42,
  model: "moonshine-tiny-en",
  backend: "moonshine",
  audioMs: 900,
});

function events(folder: string): RunEvent[] {
  const r = parseEvents(readFileSync(join(folder, "events.jsonl"), "utf8"));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe("voice session", () => {
  it("records transcripts, runs commands as mode-H actions, confirms risky ones, and stays replayable", async () => {
    const rt = await runtime();
    const { launch, computers } = launcher(rt);
    const opened = await openVoiceSession(rt, {
      launch,
      startUrl: "http://127.0.0.1:4400/login",
      recordAudio: true,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const session = opened.value;

    const fill = await runVoiceCommand(rt, session, {
      text: "fill email with alice@testbed.local",
      stt: stt("fill email with alice@testbed.local"),
      audio: new Float32Array(1600).fill(0.1),
    });
    expect(fill.outcome).toBe("executed");
    expect(computers[0]?.email).toBe("alice@testbed.local");

    const pw = await runVoiceCommand(rt, session, { text: `fill password with ${PASSWORD}` });
    expect(pw.outcome).toBe("executed");

    const click = await runVoiceCommand(rt, session, { text: "click sign in" });
    expect(click.outcome).toBe("needs_confirmation");
    expect(computers[0]?.loggedIn).toBe(false);
    const yes = await runVoiceCommand(rt, session, { text: "yes" });
    expect(yes.outcome).toBe("executed");
    expect(computers[0]?.loggedIn).toBe(true);

    const summary = await session.close();
    expect(summary?.outcome).toBe("success");
    const ev = events(session.folder);
    const speech = ev.find((e) => e.type === "model.call");
    expect(speech).toMatchObject({
      role: "speech",
      model: "moonshine:moonshine-tiny-en",
      latencyMs: 42,
      ok: true,
    });
    const inputs = ev
      .filter((e) => e.type === "human" && e.kind === "input")
      .map((e) => (e.type === "human" ? e.detail : ""));
    expect(inputs[0]).toBe(
      'voice: "fill email with alice@testbed.local" → fill → "email" = "alice@testbed.local"',
    );
    expect(ev.filter((e) => e.type === "human" && e.kind === "approval")).toHaveLength(1);
    expect(ev.filter((e) => e.type === "action").every((e) => e.type === "action" && e.mode === "H")).toBe(
      true,
    );
    expect(ev.filter((e) => e.type === "run.end")).toHaveLength(1);
    // Replayable: the three actions come back in order with their fingerprints.
    expect(actionsForReplay(ev).map((a) => a.action.type)).toEqual(["set_value", "set_value", "press"]);
    // Audio only when opted in; secrets never reach the run folder.
    expect(existsSync(join(session.folder, "audio", "utt-001.wav"))).toBe(true);
    expect(readFileSync(join(session.folder, "events.jsonl"), "utf8")).not.toContain(PASSWORD);
  });

  it("uses the confirm card hook and records the decline", async () => {
    const rt = await runtime();
    const { launch, computers } = launcher(rt);
    const asked: VoiceConfirmRequest[] = [];
    const opened = await openVoiceSession(rt, {
      launch,
      confirm: async (req) => {
        asked.push(req);
        return false;
      },
    });
    if (!opened.ok) throw new Error(opened.error);
    const r = await runVoiceCommand(rt, opened.value, { text: "click sign in" });
    expect(r.outcome).toBe("declined");
    expect(asked[0]).toMatchObject({ effect: "commit", manual: false, summary: 'click button "Sign in"' });
    expect(computers[0]?.actions).toEqual([]);
    await opened.value.close();
  });

  it(`"stop" aborts an in-flight action in under 300 ms`, async () => {
    const rt = await runtime();
    const { launch, computers } = launcher(rt);
    const opened = await openVoiceSession(rt, { launch, confirm: async () => true });
    if (!opened.ok) throw new Error(opened.error);
    const session = opened.value;
    const slow = computers[0];
    if (slow) slow.pressDelayMs = 3000;
    const inFlight = runVoiceCommand(rt, session, { text: "click sign in" });
    await new Promise((r) => setTimeout(r, 50));
    const t0 = performance.now();
    // The PTT stop-word callback calls abort() directly, before the final transcript exists.
    session.abort();
    const r = await inFlight;
    const latency = performance.now() - t0;
    expect(r.outcome).toBe("aborted");
    expect(latency).toBeLessThan(300);
    // A spoken "stop" command also works and resets the signal for the next command.
    const stop = await runVoiceCommand(rt, session, { text: "stop" });
    expect(stop.outcome).toBe("control");
    if (slow) slow.pressDelayMs = 0;
    const next = await runVoiceCommand(rt, session, { text: "show numbers" });
    expect(next.badges?.map((b) => b.name)).toEqual(["Email", "Password", "Sign in"]);
    const byBadge = await runVoiceCommand(rt, session, { text: "click 1" });
    expect(byBadge.outcome).toBe("executed");
    await session.close();
  });

  it("hands multi-step requests to the core loop inside the same run folder", async () => {
    const rt = await runtime();
    const { launch } = launcher(rt);
    const opened = await openVoiceSession(rt, {
      launch,
      startUrl: "http://127.0.0.1:4400/login",
      decision: new HeuristicDecisionProvider(),
    });
    if (!opened.ok) throw new Error(opened.error);
    const session = opened.value;
    await runVoiceCommand(rt, session, { text: "scroll down" });
    const r = await runVoiceCommand(rt, session, {
      text: 'log in with email "alice@testbed.local" and the stored password',
    });
    expect(["goal_done", "goal_failed"]).toContain(r.outcome);
    expect(r.goal).toBeDefined();
    await session.close();
    const ev = events(session.folder);
    expect(ev.filter((e) => e.type === "run.end")).toHaveLength(1);
    const steps = ev.filter((e) => e.type === "step.end").map((e) => (e.type === "step.end" ? e.step : 0));
    expect(new Set(steps).size).toBe(steps.length);
  });

  it("without a decision model, goals and unclear targets do not guess", async () => {
    const rt = await runtime();
    const { launch, computers } = launcher(rt);
    const opened = await openVoiceSession(rt, { launch });
    if (!opened.ok) throw new Error(opened.error);
    const goal = await runVoiceCommand(rt, opened.value, {
      text: "find the latest unpaid invoice and download it",
    });
    expect(goal.outcome).toBe("unresolved");
    const unclear = await runVoiceCommand(rt, opened.value, { text: "click the blue one" });
    expect(["clarify", "unresolved"]).toContain(unclear.outcome);
    expect(computers[0]?.actions).toEqual([]);
    await opened.value.close();
  });
});
