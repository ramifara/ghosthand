// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Caps the screencast rate sent to the renderer. Frames inside the interval are coalesced: only the newest
// is sent when the interval ends, so the live view never lags behind the page.

export class FrameThrottle<T> {
  readonly #intervalMs: number;
  readonly #send: (frame: T) => void;
  readonly #now: () => number;
  #last = Number.NEGATIVE_INFINITY;
  #pending: T | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(send: (frame: T) => void, opts: { intervalMs?: number; now?: () => number } = {}) {
    this.#send = send;
    this.#intervalMs = opts.intervalMs ?? 80;
    this.#now = opts.now ?? Date.now;
  }

  push(frame: T): void {
    const now = this.#now();
    const wait = this.#last + this.#intervalMs - now;
    if (wait <= 0 && this.#timer === undefined) {
      this.#last = now;
      this.#send(frame);
      return;
    }
    this.#pending = frame;
    this.#timer ??= setTimeout(() => this.#flush(), Math.max(0, wait));
  }

  #flush(): void {
    this.#timer = undefined;
    const frame = this.#pending;
    this.#pending = undefined;
    if (frame === undefined) return;
    this.#last = this.#now();
    this.#send(frame);
  }

  dispose(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#pending = undefined;
  }
}
