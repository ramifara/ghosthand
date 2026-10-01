// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Counts in-flight requests of one page for settle. WebSockets, EventSource streams and beacons are
// ignored, and so is any request in flight longer than `longPollMs` (treated as a long poll).
import type { Page, Request } from "playwright-core";

const IGNORED_TYPES = new Set(["websocket", "eventsource", "ping", "manifest"]);

export interface NetworkState {
  pending: number;
  /** Milliseconds since the last counted request started or ended. */
  quietMs: number;
  /** Requests counted since the tracker started (for evidence). */
  started: number;
}

export class NetworkTracker {
  readonly #inflight = new Map<Request, number>();
  readonly #now: () => number;
  readonly #longPollMs: number;
  #lastActivity: number;
  #started = 0;
  #page: Page | undefined;

  constructor(opts: { longPollMs?: number; now?: () => number } = {}) {
    this.#now = opts.now ?? Date.now;
    this.#longPollMs = opts.longPollMs ?? 3000;
    this.#lastActivity = this.#now();
  }

  readonly #onRequest = (req: Request): void => {
    if (IGNORED_TYPES.has(req.resourceType())) return;
    this.#inflight.set(req, this.#now());
    this.#started++;
    this.#lastActivity = this.#now();
  };

  readonly #onDone = (req: Request): void => {
    if (this.#inflight.delete(req)) this.#lastActivity = this.#now();
  };

  attach(page: Page): void {
    this.detach();
    this.#page = page;
    page.on("request", this.#onRequest);
    page.on("requestfinished", this.#onDone);
    page.on("requestfailed", this.#onDone);
  }

  detach(): void {
    const page = this.#page;
    if (!page) return;
    page.off("request", this.#onRequest);
    page.off("requestfinished", this.#onDone);
    page.off("requestfailed", this.#onDone);
    this.#inflight.clear();
    this.#page = undefined;
  }

  state(): NetworkState {
    const now = this.#now();
    let pending = 0;
    for (const started of this.#inflight.values()) if (now - started < this.#longPollMs) pending++;
    return { pending, quietMs: now - this.#lastActivity, started: this.#started };
  }
}
