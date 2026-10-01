// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { type PttEvent, PttKeyMachine } from "./ptt-keys.ts";

const run = (events: Array<[PttEvent["type"], number]>) => {
  const m = new PttKeyMachine({ tapMaxMs: 250, doubleTapWindowMs: 400 });
  return { m, actions: events.map(([type, at]) => m.feed({ type, at }).type) };
};

describe("PttKeyMachine", () => {
  it("hold to talk", () => {
    const { m, actions } = run([
      ["down", 0],
      ["up", 1200],
    ]);
    expect(actions).toEqual(["start", "stop"]);
    expect(m.listening).toBe(false);
  });

  it("ignores key auto-repeat while held", () => {
    expect(
      run([
        ["down", 0],
        ["down", 30],
        ["down", 60],
        ["up", 900],
      ]).actions,
    ).toEqual(["start", "none", "none", "stop"]);
  });

  it("a single short tap is discarded", () => {
    const { m, actions } = run([
      ["down", 0],
      ["up", 120],
    ]);
    expect(actions).toEqual(["start", "discard"]);
    expect(m.listening).toBe(false);
  });

  it("double tap toggles hands-free until the next press", () => {
    const { m, actions } = run([
      ["down", 0],
      ["up", 100],
      ["down", 300],
      ["up", 380],
    ]);
    expect(actions).toEqual(["start", "discard", "start", "toggle_on"]);
    expect(m.listening).toBe(true);
    expect(m.feed({ type: "down", at: 5000 })).toEqual({ type: "stop", reason: "toggle_off" });
    expect(m.feed({ type: "up", at: 5100 }).type).toBe("none");
    expect(m.mode).toBe("idle");
  });

  it("two taps too far apart are two discards", () => {
    expect(
      run([
        ["down", 0],
        ["up", 100],
        ["down", 600],
        ["up", 700],
      ]).actions,
    ).toEqual(["start", "discard", "start", "discard"]);
  });

  it("tap then hold is a normal hold", () => {
    expect(
      run([
        ["down", 0],
        ["up", 100],
        ["down", 300],
        ["up", 1500],
      ]).actions,
    ).toEqual(["start", "discard", "start", "stop"]);
  });

  it("stray key-up when idle does nothing", () => {
    expect(run([["up", 10]]).actions).toEqual(["none"]);
  });
});
