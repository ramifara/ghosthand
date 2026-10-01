// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { CostMeter, costUsd } from "./cost-meter.ts";

describe("costUsd", () => {
  it("prices input tokens at $0.042 per million by default", () => {
    expect(costUsd(1_000_000)).toBeCloseTo(0.042, 12);
    expect(costUsd(1834)).toBeCloseTo(0.000077028, 12);
    expect(costUsd(0)).toBe(0);
  });

  it("accepts a custom price", () => {
    expect(costUsd(2_000_000, 0.1)).toBeCloseTo(0.2, 12);
  });
});

describe("CostMeter", () => {
  it("accumulates spend, tokens and calls", () => {
    const m = new CostMeter({ capUsd: 1 });
    expect(m.add(1_000_000)).toBeCloseTo(0.042, 12);
    m.add(500_000);
    expect(m.spentUsd).toBeCloseTo(0.063, 12);
    expect(m.inputTokens).toBe(1_500_000);
    expect(m.calls).toBe(2);
    expect(m.remainingUsd).toBeCloseTo(0.937, 12);
  });

  it("returns a budget error once the cap is reached", () => {
    const m = new CostMeter({ capUsd: 0.042 });
    expect(m.check().ok).toBe(true);
    m.add(1_000_000);
    const r = m.check();
    expect(r.ok ? undefined : r.error).toMatchObject({ kind: "budget", provider: "typesafe" });
  });

  it("returns a budget error when the next call would exceed the cap", () => {
    const m = new CostMeter({ capUsd: 0.01, priceInputPerM: 1 });
    m.add(9_000); // $0.009
    expect(m.check(0.0005).ok).toBe(true);
    expect(m.check(0.002).ok).toBe(false);
  });

  it("supports an unlimited cap", () => {
    const m = new CostMeter({ capUsd: Number.POSITIVE_INFINITY });
    m.add(1e12);
    expect(m.check(1e6).ok).toBe(true);
  });
});
