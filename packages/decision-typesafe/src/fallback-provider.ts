// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Client-side failover between two decision providers (e.g. TypeSafe direct → Jev on OpenRouter).
// The secondary is asked only when the primary failed for a reason another carrier can fix:
// rate limits, overload, server and network errors, timeouts. Auth, invalid requests, oversize
// requests, budget caps and caller aborts stop at the primary: retrying them elsewhere would
// hide a config error or spend past the cap.
import type {
  DecisionAskOptions,
  DecisionCapabilities,
  DecisionError,
  DecisionErrorKind,
  DecisionProvider,
  DecisionResponse,
  Entry,
  Questions,
  Result,
} from "@ghosthand/protocol";
import { err } from "@ghosthand/protocol";
import type { DecisionLogger } from "./logger.ts";
import { silentLogger } from "./logger.ts";

export const FAILOVER_KINDS: ReadonlySet<DecisionErrorKind> = new Set<DecisionErrorKind>([
  "rate_limit",
  "overloaded",
  "server",
  "network",
  "timeout",
]);

/** Limits both providers accept, so a request that passes preflight on one passes on the other. */
export function intersectCapabilities(
  a: DecisionCapabilities,
  b: DecisionCapabilities,
): DecisionCapabilities {
  const out: DecisionCapabilities = {
    maxOptions: Math.min(a.maxOptions, b.maxOptions),
    maxLevels: Math.min(a.maxLevels, b.maxLevels),
    contextTokens: Math.min(a.contextTokens, b.contextTokens),
    zdr: a.zdr && b.zdr,
  };
  const perQuestion = [a.perQuestionContextTokens, b.perQuestionContextTokens].filter(
    (n): n is number => n !== undefined,
  );
  if (perQuestion.length > 0) out.perQuestionContextTokens = Math.min(...perQuestion);
  if (a.images === true && b.images === true) out.images = true;
  if (a.box === true && b.box === true) out.box = true;
  if (a.imageLimits && b.imageLimits) {
    out.imageLimits = {
      minSide: Math.max(a.imageLimits.minSide, b.imageLimits.minSide),
      maxSide: Math.min(a.imageLimits.maxSide, b.imageLimits.maxSide),
      minPixels: Math.max(a.imageLimits.minPixels, b.imageLimits.minPixels),
      maxPixels: Math.min(a.imageLimits.maxPixels, b.imageLimits.maxPixels),
      maxBytes: Math.min(a.imageLimits.maxBytes, b.imageLimits.maxBytes),
    };
  }
  return out;
}

export class FallbackDecisionProvider implements DecisionProvider {
  readonly id: string;
  readonly capabilities: DecisionCapabilities;
  readonly #primary: DecisionProvider;
  readonly #secondary: DecisionProvider;
  readonly #logger: DecisionLogger;

  constructor(
    primary: DecisionProvider,
    secondary: DecisionProvider,
    opts: { logger?: DecisionLogger } = {},
  ) {
    this.#primary = primary;
    this.#secondary = secondary;
    this.#logger = opts.logger ?? silentLogger;
    this.id = `fallback(${primary.id},${secondary.id})`;
    this.capabilities = intersectCapabilities(primary.capabilities, secondary.capabilities);
  }

  async ask(
    state: Entry,
    questions: Questions,
    opts: DecisionAskOptions = {},
  ): Promise<Result<DecisionResponse, DecisionError>> {
    const first = await this.#primary.ask(state, questions, opts);
    if (first.ok || !FAILOVER_KINDS.has(first.error.kind) || opts.signal?.aborted === true) return first;
    // An image request cannot be served by a text-only carrier.
    const hasImages = (opts.images?.length ?? 0) > 0;
    if (hasImages && this.#secondary.capabilities.images !== true) return first;
    this.#logger.warn(
      {
        primary: this.#primary.id,
        secondary: this.#secondary.id,
        kind: first.error.kind,
        status: first.error.status,
      },
      "decision.failover",
    );
    const second = await this.#secondary.ask(state, questions, opts);
    if (second.ok) return second;
    // Report the secondary's error but keep the primary's reason in the message.
    return err({
      ...second.error,
      message: `${second.error.message} (after ${first.error.provider}: ${first.error.kind})`,
    });
  }
}
