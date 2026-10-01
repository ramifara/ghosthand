// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { Budget } from "@ghosthand/protocol";
import type { Clock } from "./logger.ts";

export type BudgetExceeded = { kind: "steps" | "time" | "usd"; detail: string };

export class BudgetTracker {
  readonly budget: Budget;
  readonly #clock: Clock;
  readonly #startedAt: number;
  #steps = 0;
  #usd = 0;

  constructor(budget: Budget, clock: Clock) {
    this.budget = budget;
    this.#clock = clock;
    this.#startedAt = clock.now();
  }

  get steps(): number {
    return this.#steps;
  }

  get usd(): number {
    return this.#usd;
  }

  get elapsedMs(): number {
    return this.#clock.now() - this.#startedAt;
  }

  get remainingMs(): number {
    return Math.max(0, this.budget.seconds * 1000 - this.elapsedMs);
  }

  step(): void {
    this.#steps++;
  }

  spend(usd: number): void {
    this.#usd += usd;
  }

  /** Checked before every step and before every paid call. */
  exceeded(): BudgetExceeded | undefined {
    if (this.#steps >= this.budget.steps)
      return { kind: "steps", detail: `${this.#steps}/${this.budget.steps} steps` };
    if (this.elapsedMs >= this.budget.seconds * 1000)
      return { kind: "time", detail: `${Math.round(this.elapsedMs / 1000)}s/${this.budget.seconds}s` };
    if (this.#usd >= this.budget.usd)
      return { kind: "usd", detail: `$${this.#usd.toFixed(4)}/$${this.budget.usd}` };
    return undefined;
  }
}
