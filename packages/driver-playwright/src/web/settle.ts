// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Settle (plan §3.3): network quiet for 500 ms, no visible loading indicator, and 250 ms without a DOM
// mutation, capped (5 s by default). Many sites never go network-quiet (analytics beacons, long polls,
// lazy images), so once the document is complete and still, pending requests stop counting after
// `networkToleranceMs` (ADR 0016). The probes are injected so the logic is testable without a browser.
import type { NetworkState } from "./network-tracker.ts";

export interface SettleOptions {
  capMs: number;
  networkQuietMs: number;
  domQuietMs: number;
  pollMs: number;
  /** With the document complete and still, network activity stops blocking after this long. */
  networkToleranceMs: number;
}

export const DEFAULT_SETTLE: SettleOptions = {
  capMs: 5000,
  networkQuietMs: 500,
  domQuietMs: 250,
  pollMs: 50,
  networkToleranceMs: 1200,
};

export interface DomState {
  sinceMutation: number;
  busy: string | null;
  readyState: string;
}

export interface SettleProbes {
  network(): NetworkState;
  /** Undefined while the document is unavailable (e.g. mid-navigation). */
  dom(): Promise<DomState | undefined>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface SettleResult {
  waitedMs: number;
  /** "idle", or "cap: <what was still busy>". */
  reason: string;
}

function blockers(
  net: NetworkState,
  dom: DomState | undefined,
  opts: SettleOptions,
  waitedMs: number,
): string[] {
  const out: string[] = [];
  // "interactive" counts: heavy pages stay short of "complete" for seconds while images and scripts load.
  const domStill =
    dom !== undefined &&
    dom.readyState !== "loading" &&
    dom.busy === null &&
    dom.sinceMutation >= opts.domQuietMs;
  const networkTolerated = domStill && waitedMs >= opts.networkToleranceMs;
  if (!networkTolerated) {
    if (net.pending > 0) out.push(`network busy (${net.pending} in flight)`);
    else if (net.quietMs < opts.networkQuietMs) out.push("network recently active");
  }
  if (dom === undefined) out.push("document unavailable");
  else {
    if (dom.readyState === "loading") out.push("document loading");
    if (dom.busy !== null) out.push(`loading indicator ${dom.busy}`);
    if (dom.sinceMutation < opts.domQuietMs) out.push("DOM mutating");
  }
  return out;
}

export async function waitForSettle(probes: SettleProbes, opts: SettleOptions): Promise<SettleResult> {
  const start = probes.now();
  for (;;) {
    const dom = await probes.dom();
    const net = probes.network();
    const waited = probes.now() - start;
    const busy = blockers(net, dom, opts, waited);
    if (busy.length === 0)
      return {
        waitedMs: waited,
        reason: net.pending > 0 ? "idle (document still; network left active)" : "idle",
      };
    if (waited >= opts.capMs) return { waitedMs: waited, reason: `cap: ${busy.join(", ")}` };
    await probes.sleep(Math.min(opts.pollMs, Math.max(1, opts.capMs - waited)));
  }
}
