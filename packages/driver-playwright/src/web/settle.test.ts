// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import type { NetworkState } from "./network-tracker.ts";
import type { DomState, SettleProbes } from "./settle.ts";
import { DEFAULT_SETTLE, waitForSettle } from "./settle.ts";

/** A scripted page on a fake clock: requests end at `netEndsAt`, the DOM stops changing at `domEndsAt`. */
function fakePage(opts: {
  netEndsAt: number;
  domEndsAt: number;
  busyUntil?: number;
  unavailableUntil?: number;
}) {
  let now = 0;
  const probes: SettleProbes = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    network: (): NetworkState => ({
      pending: now < opts.netEndsAt ? 1 : 0,
      quietMs: now < opts.netEndsAt ? 0 : now - opts.netEndsAt,
      started: 1,
    }),
    dom: async (): Promise<DomState | undefined> => {
      if (opts.unavailableUntil !== undefined && now < opts.unavailableUntil) return undefined;
      return {
        sinceMutation: now < opts.domEndsAt ? 0 : now - opts.domEndsAt,
        busy: opts.busyUntil !== undefined && now < opts.busyUntil ? "div.spinner" : null,
        readyState: "complete",
      };
    },
  };
  return probes;
}

describe("waitForSettle", () => {
  it("waits for network quiet (500 ms) and DOM quiet (250 ms)", async () => {
    const r = await waitForSettle(fakePage({ netEndsAt: 1000, domEndsAt: 1200 }), {
      ...DEFAULT_SETTLE,
      networkToleranceMs: 60_000,
    });
    expect(r.reason).toBe("idle");
    expect(r.waitedMs).toBeGreaterThanOrEqual(1500);
    expect(r.waitedMs).toBeLessThan(1600);
  });

  it("waits for loading indicators to disappear", async () => {
    const r = await waitForSettle(fakePage({ netEndsAt: 0, domEndsAt: 0, busyUntil: 2000 }), DEFAULT_SETTLE);
    expect(r.reason).toBe("idle");
    expect(r.waitedMs).toBeGreaterThanOrEqual(2000);
  });

  it("stops waiting for a network that never goes quiet once the document is still", async () => {
    const r = await waitForSettle(fakePage({ netEndsAt: 60_000, domEndsAt: 0 }), DEFAULT_SETTLE);
    expect(r.waitedMs).toBeGreaterThanOrEqual(DEFAULT_SETTLE.networkToleranceMs);
    expect(r.waitedMs).toBeLessThan(DEFAULT_SETTLE.networkToleranceMs + 100);
    expect(r.reason).toMatch(/^idle \(document still/);
  });

  it("returns at the cap with what was still busy", async () => {
    const r = await waitForSettle(fakePage({ netEndsAt: 60_000, domEndsAt: 60_000 }), DEFAULT_SETTLE);
    expect(r.waitedMs).toBe(5000);
    expect(r.reason).toMatch(/^cap: network busy/);
  });

  it("tolerates the network only once the DOM has been still for its quiet window", async () => {
    // The DOM stops changing at 2500 ms; the network stays busy until 3000 ms.
    const r = await waitForSettle(fakePage({ netEndsAt: 3000, domEndsAt: 2500 }), DEFAULT_SETTLE);
    expect(r.reason).toMatch(/^idle/);
    expect(r.waitedMs).toBeGreaterThanOrEqual(2750);
    expect(r.waitedMs).toBeLessThan(2850);
  });

  it("treats an unavailable document as busy", async () => {
    const r = await waitForSettle(fakePage({ netEndsAt: 0, domEndsAt: 0, unavailableUntil: 300 }), {
      ...DEFAULT_SETTLE,
      networkQuietMs: 0,
      domQuietMs: 0,
    });
    expect(r.waitedMs).toBeGreaterThanOrEqual(300);
  });

  it("returns at once on a quiet page", async () => {
    const r = await waitForSettle(fakePage({ netEndsAt: -1000, domEndsAt: -1000 }), DEFAULT_SETTLE);
    expect(r).toEqual({ waitedMs: 0, reason: "idle" });
  });
});
