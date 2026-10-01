// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Local cost accounting. The direct TypeSafe API reports tokens but no cost, and the console has no
// documented spend limit, so we price input tokens ourselves and enforce our own cap (ADR 0004).
import type { DecisionError, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";

/** USD per million input tokens for Jev on the direct API. Output tokens are free. */
export const DEFAULT_PRICE_INPUT_PER_M = 0.042;

/** Cost in USD of a request with `inputTokens` billable input tokens. */
export function costUsd(inputTokens: number, priceInputPerM: number = DEFAULT_PRICE_INPUT_PER_M): number {
  return (inputTokens * priceInputPerM) / 1e6;
}

export interface CostMeterOptions {
  /** Spend cap in USD. `Infinity` disables the cap. */
  capUsd: number;
  priceInputPerM?: number;
  provider?: string;
}

/** Cumulative spend across calls, with a hard cap that yields a `budget` DecisionError. */
export class CostMeter {
  readonly capUsd: number;
  readonly priceInputPerM: number;
  readonly provider: string;
  #spentUsd = 0;
  #inputTokens = 0;
  #calls = 0;

  constructor(opts: CostMeterOptions) {
    if (!(opts.capUsd >= 0)) throw new RangeError(`capUsd must be >= 0, got ${String(opts.capUsd)}`);
    this.capUsd = opts.capUsd;
    this.priceInputPerM = opts.priceInputPerM ?? DEFAULT_PRICE_INPUT_PER_M;
    this.provider = opts.provider ?? "typesafe";
  }

  get spentUsd(): number {
    return this.#spentUsd;
  }

  get inputTokens(): number {
    return this.#inputTokens;
  }

  get calls(): number {
    return this.#calls;
  }

  get remainingUsd(): number {
    return Math.max(0, this.capUsd - this.#spentUsd);
  }

  /** Records a completed call and returns its cost. */
  add(inputTokens: number): number {
    const cost = costUsd(inputTokens, this.priceInputPerM);
    this.#spentUsd += cost;
    this.#inputTokens += inputTokens;
    this.#calls += 1;
    return cost;
  }

  /**
   * Checks whether a call costing about `estimatedUsd` more fits under the cap.
   * Fails once spend has reached the cap or would exceed it with this call.
   */
  check(estimatedUsd = 0): Result<void, DecisionError> {
    if (this.#spentUsd >= this.capUsd || this.#spentUsd + estimatedUsd > this.capUsd) {
      return err({
        kind: "budget",
        provider: this.provider,
        message: `decision spend cap of $${this.capUsd} reached (spent $${this.#spentUsd.toFixed(6)}, next call ~$${estimatedUsd.toFixed(6)})`,
      });
    }
    return ok(undefined);
  }
}
