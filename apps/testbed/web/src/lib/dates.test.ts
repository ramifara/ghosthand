// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { addDays, addMonths, isIsoDate, longDate, monthGrid, monthOf, monthTitle } from "./dates.ts";

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isIsoDate("2026-01-12")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-1-2")).toBe(false);
  });

  it("moves across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(monthTitle(monthOf("2026-03-02"))).toBe("March 2026");
  });

  it("builds a Sunday-first grid and long labels", () => {
    const grid = monthGrid({ year: 2026, month: 0 });
    // January 1, 2026 is a Thursday.
    expect(grid[0]).toEqual([null, null, null, null, "2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(grid.flat().filter(Boolean)).toHaveLength(31);
    expect(longDate("2026-01-12")).toBe("Monday, January 12, 2026");
  });
});
