// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Push-to-talk key logic (pure, timing-based): hold to talk; a quick double tap toggles hands-free for
// one command, ended by the next press. Key auto-repeat is ignored.
//
//   hold:        down ─────────────── up            → start … stop("release")
//   short tap:   down ─ up                          → start … discard (too short to be speech)
//   double tap:  down ─ up ─ down ─ up (in window)  → start … discard, start … toggle_on (keeps listening)
//   toggle off:  down                               → stop("toggle_off"); the matching up is ignored

export type PttEvent = { type: "down" | "up"; at: number };

export type PttAction =
  | { type: "start" }
  | { type: "stop"; reason: "release" | "toggle_off" }
  | { type: "discard" }
  | { type: "toggle_on" }
  | { type: "none" };

export interface PttTiming {
  /** A press shorter than this is a tap, not a hold. */
  tapMaxMs: number;
  /** Max time from the first tap's release to the second tap's press. */
  doubleTapWindowMs: number;
}

export const DEFAULT_PTT_TIMING: PttTiming = { tapMaxMs: 250, doubleTapWindowMs: 400 };

type State =
  | { kind: "idle"; lastTapUpAt?: number }
  | { kind: "holding"; downAt: number; afterTapUpAt?: number }
  | { kind: "toggled" }
  | { kind: "releasing" };

export class PttKeyMachine {
  #state: State = { kind: "idle" };
  readonly #timing: PttTiming;

  constructor(timing: Partial<PttTiming> = {}) {
    this.#timing = { ...DEFAULT_PTT_TIMING, ...timing };
  }

  get listening(): boolean {
    return this.#state.kind === "holding" || this.#state.kind === "toggled";
  }

  get mode(): State["kind"] {
    return this.#state.kind;
  }

  feed(e: PttEvent): PttAction {
    const s = this.#state;
    if (e.type === "down") {
      switch (s.kind) {
        case "holding":
        case "releasing":
          return { type: "none" }; // auto-repeat, or the toggle-off press still held
        case "toggled":
          this.#state = { kind: "releasing" };
          return { type: "stop", reason: "toggle_off" };
        case "idle": {
          const inWindow =
            s.lastTapUpAt !== undefined && e.at - s.lastTapUpAt <= this.#timing.doubleTapWindowMs;
          this.#state = {
            kind: "holding",
            downAt: e.at,
            ...(inWindow ? { afterTapUpAt: s.lastTapUpAt } : {}),
          };
          return { type: "start" };
        }
      }
    }
    switch (s.kind) {
      case "holding": {
        const held = e.at - s.downAt;
        if (held >= this.#timing.tapMaxMs) {
          this.#state = { kind: "idle" };
          return { type: "stop", reason: "release" };
        }
        if (s.afterTapUpAt !== undefined) {
          this.#state = { kind: "toggled" };
          return { type: "toggle_on" };
        }
        this.#state = { kind: "idle", lastTapUpAt: e.at };
        return { type: "discard" };
      }
      case "releasing":
        this.#state = { kind: "idle" };
        return { type: "none" };
      default:
        return { type: "none" };
    }
  }

  reset(): void {
    this.#state = { kind: "idle" };
  }
}
