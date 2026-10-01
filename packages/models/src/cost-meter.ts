// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Dollar cost of model calls from catalog prices, and a spend cap across calls. The AI SDK
// reports tokens but no cost for OpenAI, so we price usage ourselves.
import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { ModelPricing } from "./catalog/model-catalog.ts";
import type { ModelError } from "./model-error.ts";

export interface ModelUsage {
  /** All input tokens, cached or not. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** Included in `outputTokens`. */
  readonly reasoningTokens: number;
  readonly totalTokens: number;
}

export const ZERO_USAGE: ModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

/**
 * Cost in USD. Cached reads and writes use their own prices when the catalog has them, else the
 * input price. Unknown pricing costs 0 (local models, or a model the catalog does not price).
 * Long-context price tiers are not modelled in v0.
 */
export function costForUsage(usage: ModelUsage, pricing: ModelPricing | undefined): number {
  if (pricing === undefined) return 0;
  const cached = usage.cacheReadTokens + usage.cacheWriteTokens;
  const uncached = Math.max(0, usage.inputTokens - cached);
  const micro =
    uncached * pricing.inputPerM +
    usage.cacheReadTokens * (pricing.cacheReadPerM ?? pricing.inputPerM) +
    usage.cacheWriteTokens * (pricing.cacheWritePerM ?? pricing.inputPerM) +
    usage.outputTokens * pricing.outputPerM;
  return micro / 1e6;
}

/** Rough characters-per-token ratio for pre-call estimates. */
export const CHARS_PER_TOKEN = 4;
/** Rough input tokens for one screenshot at default detail. */
export const TOKENS_PER_IMAGE = 1_500;

/** A lower-bound estimate of a call's input cost, for the pre-call cap check. */
export function estimateInputCost(chars: number, images: number, pricing: ModelPricing | undefined): number {
  if (pricing === undefined) return 0;
  const tokens = Math.ceil(chars / CHARS_PER_TOKEN) + images * TOKENS_PER_IMAGE;
  return (tokens * pricing.inputPerM) / 1e6;
}

export interface ModelCostMeterOptions {
  /** Spend cap in USD across all calls through this meter. `Infinity` disables it. */
  readonly capUsd: number;
}

/** Cumulative spend with a hard cap that yields a `budget` ModelError. */
export class ModelCostMeter {
  readonly capUsd: number;
  #spentUsd = 0;
  #calls = 0;
  #inputTokens = 0;
  #outputTokens = 0;

  constructor(options: ModelCostMeterOptions) {
    if (!(options.capUsd >= 0)) throw new RangeError(`capUsd must be >= 0, got ${String(options.capUsd)}`);
    this.capUsd = options.capUsd;
  }

  get spentUsd(): number {
    return this.#spentUsd;
  }

  get calls(): number {
    return this.#calls;
  }

  get inputTokens(): number {
    return this.#inputTokens;
  }

  get outputTokens(): number {
    return this.#outputTokens;
  }

  get remainingUsd(): number {
    return Math.max(0, this.capUsd - this.#spentUsd);
  }

  /** Records a finished call (successful or not: failed calls can still bill tokens). */
  add(costUsd: number, usage: ModelUsage = ZERO_USAGE): void {
    this.#spentUsd += costUsd;
    this.#calls += 1;
    this.#inputTokens += usage.inputTokens;
    this.#outputTokens += usage.outputTokens;
  }

  /** Fails once spend has reached the cap or would pass it with a call costing `estimatedUsd`. */
  check(estimatedUsd = 0): Result<void, ModelError> {
    if (this.#spentUsd >= this.capUsd || this.#spentUsd + estimatedUsd > this.capUsd) {
      return err({
        kind: "budget",
        message: `model spend cap of $${this.capUsd} reached (spent $${this.#spentUsd.toFixed(6)}, next call ~$${estimatedUsd.toFixed(6)})`,
      });
    }
    return ok(undefined);
  }
}
