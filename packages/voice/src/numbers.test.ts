// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { parseCardinal, parseOrdinal } from "./numbers.ts";

describe("numbers", () => {
  it.each([
    ["12", 12],
    ["twelve", 12],
    ["twenty one", 21],
    ["twenty-one", 21],
    ["a hundred and five", 105],
    ["three hundred", 300],
    ["two thousand and twenty six", 2026],
  ])("cardinal %s", (text, n) => {
    expect(parseCardinal(text)).toBe(n);
  });

  it("maps homophones only in a numeric slot", () => {
    expect(parseCardinal("to")).toBeUndefined();
    expect(parseCardinal("to", true)).toBe(2);
    expect(parseCardinal("for", true)).toBe(4);
    expect(parseCardinal("settings")).toBeUndefined();
  });

  it.each([
    ["first", 1],
    ["second", 2],
    ["2nd", 2],
    ["twenty first", 21],
    ["last", -1],
    ["second to last", -2],
    ["second last", -2],
  ])("ordinal %s", (text, n) => {
    expect(parseOrdinal(text)).toBe(n);
  });

  it("rejects non-ordinals", () => {
    expect(parseOrdinal("invoice")).toBeUndefined();
    expect(parseOrdinal("blue first")).toBeUndefined();
  });
});
