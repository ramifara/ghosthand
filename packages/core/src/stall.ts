// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Stall, repeat and cycle detection, computed in code from screen signatures and actions.
import type { Snapshot } from "@ghosthand/protocol";

/** A cheap signature of what the user can see: URL, title, element names/states/values and page text. */
export function screenSignature(snapshot: Snapshot): string {
  const parts = [snapshot.url ?? "", snapshot.title, snapshot.text.slice(0, 2000)];
  for (const e of snapshot.elements) parts.push(`${e.role}|${e.name}|${e.states.join(",")}|${e.value ?? ""}`);
  return fnv1a(parts.join("\n"));
}

export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface StallVerdict {
  /** Consecutive steps whose action left the screen unchanged. */
  noChangeSteps: number;
  /** Times the same action key was attempted on the same screen. */
  repeats: number;
  /** A screen seen before re-appeared after other screens (A → B → A ...). */
  cycle: boolean;
  stalled: boolean;
  reason?: string;
}

export interface StallLimits {
  noChange: number;
  repeats: number;
}

export const DEFAULT_STALL_LIMITS: StallLimits = { noChange: 3, repeats: 2 };

export class StallDetector {
  readonly #limits: StallLimits;
  #noChange = 0;
  #lastScreen: string | undefined;
  readonly #screens: string[] = [];
  readonly #attempts = new Map<string, number>();

  constructor(limits: StallLimits = DEFAULT_STALL_LIMITS) {
    this.#limits = limits;
  }

  /** Call once per observation, before deciding. */
  observe(screen: string): void {
    if (this.#lastScreen !== undefined) this.#noChange = screen === this.#lastScreen ? this.#noChange + 1 : 0;
    this.#lastScreen = screen;
    this.#screens.push(screen);
  }

  /** Call when an action is about to run on the current screen. Returns how often it was tried here before. */
  attempt(actionKey: string): number {
    const key = `${this.#lastScreen}|${actionKey}`;
    const n = this.#attempts.get(key) ?? 0;
    this.#attempts.set(key, n + 1);
    return n;
  }

  /** Was this action already tried on the current screen? */
  triedHere(actionKey: string): boolean {
    return (this.#attempts.get(`${this.#lastScreen}|${actionKey}`) ?? 0) > 0;
  }

  verdict(): StallVerdict {
    const repeats = Math.max(
      0,
      ...[...this.#attempts].filter(([k]) => k.startsWith(`${this.#lastScreen}|`)).map(([, n]) => n - 1),
    );
    const last = this.#screens.at(-1);
    const cycle =
      last !== undefined &&
      this.#screens.length >= 4 &&
      this.#screens.slice(0, -2).includes(last) &&
      this.#screens.at(-2) !== last;
    if (this.#noChange >= this.#limits.noChange)
      return {
        noChangeSteps: this.#noChange,
        repeats,
        cycle,
        stalled: true,
        reason: `${this.#noChange} steps without change`,
      };
    if (repeats >= this.#limits.repeats)
      return {
        noChangeSteps: this.#noChange,
        repeats,
        cycle,
        stalled: true,
        reason: `same action repeated ${repeats + 1} times`,
      };
    return { noChangeSteps: this.#noChange, repeats, cycle, stalled: false };
  }
}
