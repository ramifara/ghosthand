// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import type { ModelUsage } from "./cost-meter.ts";
import { costForUsage, estimateInputCost, ModelCostMeter, ZERO_USAGE } from "./cost-meter.ts";

const usage = (u: Partial<ModelUsage>): ModelUsage => ({ ...ZERO_USAGE, ...u });

describe("costForUsage", () => {
  it("prices input and output per million tokens", () => {
    const cost = costForUsage(usage({ inputTokens: 1_000_000, outputTokens: 100_000 }), {
      inputPerM: 2,
      outputPerM: 10,
    });
    expect(cost).toBeCloseTo(3, 10);
  });

  it("prices cached reads and writes separately from fresh input", () => {
    // 1200 input of which 200 cached reads and 100 cache writes; 80 output (16 of them reasoning).
    const u = usage({ inputTokens: 1200, cacheReadTokens: 200, cacheWriteTokens: 100, outputTokens: 80 });
    const cost = costForUsage(u, { inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.2, cacheWritePerM: 2.5 });
    expect(cost).toBeCloseTo((900 * 2 + 200 * 0.2 + 100 * 2.5 + 80 * 10) / 1e6, 12);
  });

  it("falls back to the input price when cache prices are unknown", () => {
    const u = usage({ inputTokens: 1000, cacheReadTokens: 400, outputTokens: 0 });
    expect(costForUsage(u, { inputPerM: 1, outputPerM: 1 })).toBeCloseTo(1000 / 1e6, 12);
  });

  it("is zero without pricing", () => {
    expect(costForUsage(usage({ inputTokens: 5000, outputTokens: 5000 }), undefined)).toBe(0);
  });

  it("estimates input cost from characters and images", () => {
    expect(estimateInputCost(4000, 2, { inputPerM: 1, outputPerM: 1 })).toBeCloseTo((1000 + 3000) / 1e6, 12);
    expect(estimateInputCost(4000, 2, undefined)).toBe(0);
  });
});

describe("ModelCostMeter", () => {
  it("accumulates spend and tokens", () => {
    const meter = new ModelCostMeter({ capUsd: 1 });
    meter.add(0.25, usage({ inputTokens: 100, outputTokens: 10 }));
    meter.add(0.25);
    expect(meter.spentUsd).toBeCloseTo(0.5);
    expect(meter.calls).toBe(2);
    expect(meter.inputTokens).toBe(100);
    expect(meter.outputTokens).toBe(10);
    expect(meter.remainingUsd).toBeCloseTo(0.5);
  });

  it("fails with a budget error at or over the cap", () => {
    const meter = new ModelCostMeter({ capUsd: 0.01 });
    expect(meter.check(0.005).ok).toBe(true);
    expect(meter.check(0.02).ok).toBe(false);
    meter.add(0.01);
    const r = meter.check();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("budget");
  });

  it("allows an infinite cap and rejects a negative one", () => {
    expect(new ModelCostMeter({ capUsd: Number.POSITIVE_INFINITY }).check(1e9).ok).toBe(true);
    expect(() => new ModelCostMeter({ capUsd: -1 })).toThrow(RangeError);
  });
});
