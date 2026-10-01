// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { detectStopWord } from "./stop-words.ts";

describe("detectStopWord", () => {
  it.each([
    ["stop", "stop"],
    ["Stop.", "stop"],
    ["STOP STOP", "stop"],
    ["no, stop", "stop"],
    ["wait stop it", "stop"],
    ["halt", "stop"],
    ["cancel", "cancel"],
    ["never mind", "cancel"],
    ["Okay, cancel that.", "cancel"],
    ["stop rec", "stop"],
  ])("%s → %s", (partial, kind) => {
    expect(detectStopWord(partial)?.kind).toBe(kind);
  });

  it.each(["click the stop button", "", "scroll down", "wait", "don't stop", "type cancel order"])(
    "no hit: %s",
    (partial) => {
      expect(detectStopWord(partial)).toBeUndefined();
    },
  );

  it("is fast enough to run on every partial (< 0.05 ms per call)", () => {
    const partials = ["no, stop", "click the second invoice and then", "cancel", "scroll down a bit"];
    const start = performance.now();
    for (let i = 0; i < 20_000; i++) detectStopWord(partials[i % partials.length] ?? "");
    expect((performance.now() - start) / 20_000).toBeLessThan(0.05);
  });
});
