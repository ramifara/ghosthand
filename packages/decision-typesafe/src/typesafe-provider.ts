// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// DecisionProvider over the direct TypeSafe API (ADR 0004). This package is the only importer of
// `@typesafe-ai/sdk`; nothing SDK-shaped leaves it.
import type {
  DecisionAskOptions,
  DecisionCapabilities,
  DecisionError,
  DecisionImageData,
  DecisionProvider,
  DecisionResponse,
  Entry,
  Question,
  Questions,
  Result,
} from "@ghosthand/protocol";
import { err, MAX_CHOICE_OPTIONS, MAX_SCORE_LEVELS, ok } from "@ghosthand/protocol";
import type {
  Logger as SdkLogger,
  Question as SdkQuestion,
  Questions as SdkQuestions,
} from "@typesafe-ai/sdk";
import { image as sdkImage, TypeSafeClient } from "@typesafe-ai/sdk";
import type { CostMeter } from "./cost-meter.ts";
import { costUsd, DEFAULT_PRICE_INPUT_PER_M } from "./cost-meter.ts";
import { IMAGES_HEADER, TYPESAFE_IMAGE_LIMITS } from "./images.ts";
import type { DecisionLogger } from "./logger.ts";
import { silentLogger } from "./logger.ts";
import { mapSdkError } from "./map-sdk-error.ts";
import type { TokenEstimate } from "./preflight.ts";
import { estimateRequestTokens, preflight } from "./preflight.ts";
import { abstainedNames, validateAnswers } from "./validate-response.ts";
import { reportedCostUsd, WireResponse } from "./wire.ts";

export const PROVIDER_NAME = "typesafe";
export const DEFAULT_MODEL = "jev-1.13.0";
/** Model for requests with an image or a box question (box needs Jev 1.14; ADR 0020). */
export const DEFAULT_VISION_MODEL = "jev-1.14.0";
export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_TIMEOUT_MS = 2500;
export const DEFAULT_RETRIES = 1;

/** Limits of the direct API (docs /models, /api). */
export const TYPESAFE_DIRECT_CAPABILITIES: DecisionCapabilities = {
  maxOptions: MAX_CHOICE_OPTIONS,
  maxLevels: MAX_SCORE_LEVELS,
  contextTokens: 64_000,
  perQuestionContextTokens: 32_000,
  zdr: false,
  images: true,
  box: true,
  imageLimits: TYPESAFE_IMAGE_LIMITS,
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TypeSafeDecisionProviderOptions {
  apiKey: string;
  /** Pinned model ID for text-only requests. Default `jev-1.13.0`. */
  model?: string;
  /** Pinned model ID for requests with images or box questions. Default `jev-1.14.0`. */
  visionModel?: string;
  /** Per-attempt timeout. Default 2500 ms. */
  timeoutMs?: number;
  /** Retries after the first attempt on 408/429/5xx, timeouts and connection errors. Default 1. */
  retries?: number;
  /** API root. Defaults to the direct API; the `TYPESAFE_BASE_URL` env var is deliberately ignored. */
  baseUrl?: string;
  /** Custom fetch (tests, Electron `net.fetch`). Must support `Response.clone()` and stream bodies. */
  fetch?: FetchLike;
  /**
   * Request body compression. Default: the SDK's (zstd for bodies of 1 KiB or more on Node 22.15+).
   * Carriers set `false`: gateway support for compressed bodies is unverified.
   */
  compression?: "zstd" | false;
  /** USD per million input tokens. Default 0.042. */
  priceInputPerM?: number;
  logger?: DecisionLogger;
  /** Shared spend meter. When set, calls fail with `budget` once the cap is reached. */
  costMeter?: CostMeter;
  /** Overrides for the advertised limits, e.g. for a gateway with a smaller context or a limits probe. */
  capabilities?: Partial<DecisionCapabilities>;
  /**
   * Name reported in responses, errors and logs (`typesafe`, `openrouter`, `vercel`). Carrier
   * presets set it; default `typesafe`.
   */
  providerName?: string;
  /** Send requests without local shape and size checks. Only for `scripts/probe-jev.ts` limit probes. */
  skipPreflight?: boolean;
  /** Monotonic clock in ms, for latency. Default `performance.now`. */
  now?: () => number;
}

/** Forwards only SDK warnings and errors, without their arguments, which can carry request bodies. */
function sdkLoggerFor(logger: DecisionLogger, provider: string): SdkLogger {
  const drop = (): void => {};
  return {
    debug: drop,
    info: drop,
    warn: (message: string) => logger.warn({ provider, sdk: true }, message),
    error: (message: string) => logger.error({ provider, sdk: true }, message),
  };
}

/** Rebuilds a protocol question in the SDK's shape, dropping undefined optionals. */
function toSdkQuestion(q: Question): SdkQuestion {
  switch (q.type) {
    case "noul": {
      const out: SdkQuestion = { type: "noul" };
      if (q.instructions !== undefined) out.instructions = q.instructions;
      if (q.criteria !== undefined) {
        const criteria: { true?: Entry; false?: Entry } = {};
        if (q.criteria.true !== undefined) criteria.true = q.criteria.true;
        if (q.criteria.false !== undefined) criteria.false = q.criteria.false;
        out.criteria = criteria;
      }
      return out;
    }
    case "choice": {
      const out: SdkQuestion = { type: "choice", criteria: q.criteria };
      if (q.instructions !== undefined) out.instructions = q.instructions;
      return out;
    }
    case "score": {
      // Preflight guarantees at least two levels; the SDK's type wants that as a tuple.
      const [first = null, second = null, ...rest] = q.criteria;
      const out: SdkQuestion = { type: "score", criteria: [first, second, ...rest] };
      if (q.instructions !== undefined) out.instructions = q.instructions;
      return out;
    }
    case "box": {
      const out: SdkQuestion = { type: "box" };
      if (q.instructions !== undefined) out.instructions = q.instructions;
      return out;
    }
  }
}

function toSdkQuestions(questions: Questions): SdkQuestions {
  const out: SdkQuestions = {};
  for (const [name, q] of Object.entries(questions)) out[name] = toSdkQuestion(q);
  return out;
}

/** Image refs and sizes only. Never bytes. */
function describeImages(images: readonly DecisionImageData[]): Array<Record<string, unknown>> {
  return images.map((i) => ({ ref: i.ref, width: i.width, height: i.height, bytes: i.data.byteLength }));
}

/** Question names, types and sizes only. Never instructions, criteria text or state. */
function describeQuestions(questions: Questions): Array<Record<string, unknown>> {
  return Object.entries(questions).map(([name, q]) => {
    if (q.type === "choice") return { name, type: q.type, options: Object.keys(q.criteria).length };
    if (q.type === "score") return { name, type: q.type, levels: q.criteria.length };
    return { name, type: q.type };
  });
}

export function createTypeSafeDecisionProvider(opts: TypeSafeDecisionProviderOptions): DecisionProvider {
  const textModel = opts.model ?? DEFAULT_MODEL;
  const visionModel = opts.visionModel ?? DEFAULT_VISION_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const price = opts.priceInputPerM ?? DEFAULT_PRICE_INPUT_PER_M;
  const logger = opts.logger ?? silentLogger;
  const now = opts.now ?? (() => performance.now());
  const capabilities: DecisionCapabilities = { ...TYPESAFE_DIRECT_CAPABILITIES, ...opts.capabilities };
  const provider = opts.providerName ?? PROVIDER_NAME;

  let client: TypeSafeClient | undefined;

  /** Built on first use so a missing key surfaces as a Result, not a constructor throw. */
  function getClient(): Result<TypeSafeClient, DecisionError> {
    if (client) return ok(client);
    if (opts.apiKey.trim() === "") {
      return err({ kind: "auth", provider, message: "no TypeSafe API key configured (TYPESAFE_API_KEY)" });
    }
    try {
      client = new TypeSafeClient({
        apiKey: opts.apiKey,
        baseURL: opts.baseUrl ?? DEFAULT_BASE_URL,
        defaultModel: textModel,
        timeout: timeoutMs,
        retry: { maxRetries: retries, backoffInitialMs: 200, backoffMaxMs: 800, maxRetryAfterMs: 1000 },
        // Never `debug`: it logs full request bodies (the screen state). Explicit, so env can't override.
        logLevel: "warn",
        logger: sdkLoggerFor(logger, provider),
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        ...(opts.compression !== undefined ? { compression: opts.compression } : {}),
      });
      return ok(client);
    } catch (e) {
      return err(mapSdkError(e, provider));
    }
  }

  async function ask(
    state: Entry,
    questions: Questions,
    askOpts: DecisionAskOptions = {},
  ): Promise<Result<DecisionResponse, DecisionError>> {
    const { signal } = askOpts;
    const images = askOpts.images ?? [];
    if (signal?.aborted) return err({ kind: "aborted", provider, message: "aborted before sending" });
    if (state === null) return err({ kind: "invalid", provider, message: "state must not be null" });
    const visual = images.length > 0 || Object.values(questions).some((q) => q.type === "box");
    const model = visual ? visionModel : textModel;

    let estimate: TokenEstimate;
    if (opts.skipPreflight) {
      estimate = estimateRequestTokens(state, questions, images);
    } else {
      const pre = preflight(state, questions, capabilities, provider, images);
      if (!pre.ok) {
        logger.warn(
          { provider, model, kind: pre.error.kind, questions: describeQuestions(questions) },
          pre.error.message,
        );
        return pre;
      }
      estimate = pre.value;
    }

    if (opts.costMeter) {
      const budget = opts.costMeter.check(costUsd(estimate.total, price));
      if (!budget.ok) {
        logger.warn(
          { provider, model, kind: "budget", spentUsd: opts.costMeter.spentUsd },
          "decision.budget",
        );
        return budget;
      }
    }

    const c = getClient();
    if (!c.ok) return c;

    logger.debug(
      {
        provider,
        model,
        questions: describeQuestions(questions),
        estimatedTokens: estimate.total,
        ...(images.length > 0 ? { images: describeImages(images), imageTokens: estimate.imageTokens } : {}),
      },
      "decision.request",
    );

    // Images go in `assets` under the ref the state already uses; the SDK sends them as multipart parts.
    const assets = Object.fromEntries(images.map((i) => [i.ref, sdkImage(i.data)]));
    const requestOptions = {
      ...(signal ? { signal } : {}),
      ...(visual ? { headers: { [IMAGES_HEADER]: "true" } } : {}),
    };

    const started = now();
    let data: unknown;
    let requestId: string | undefined;
    try {
      const res = await c.value
        .systemOne(
          {
            state,
            questions: toSdkQuestions(questions),
            model,
            ...(images.length > 0 ? { assets } : {}),
          },
          requestOptions,
        )
        .withResponse();
      data = res.data;
      requestId = res.requestId;
    } catch (e) {
      const error = mapSdkError(e, provider);
      // A pinned version that was retired (or a typo) comes back as a 400/404 naming the model.
      if ((error.status === 404 || error.status === 400) && /model/i.test(error.message)) {
        error.message = `${error.message} (model "${model}" unavailable? set decision.model or decision.visionModel to a current version)`;
      }
      const latencyMs = Math.round(now() - started);
      logger.warn(
        { provider, model, kind: error.kind, status: error.status, requestId: error.requestId, latencyMs },
        "decision.error",
      );
      return err(error);
    }
    const latencyMs = Math.max(0, now() - started);

    const envelope = WireResponse.safeParse(data);
    if (!envelope.success) {
      const error: DecisionError = { kind: "server", provider, message: "malformed response body" };
      if (requestId !== undefined) error.requestId = requestId;
      logger.warn({ provider, model, kind: error.kind, requestId, latencyMs }, "decision.error");
      return err(error);
    }
    const body = envelope.data;
    // Carriers echo a dated snapshot (`typesafe/jev-1.13-20260917`); only a different model is news.
    if (body.model !== model && !body.model.startsWith(model)) {
      logger.warn({ provider, requested: model, reported: body.model, requestId }, "decision.model_mismatch");
    }

    const answers = validateAnswers(questions, body.answers);
    // The API may omit token counts (SDK 0.7.0 `Usage`); bill the preflight estimate then.
    const usageSource = body.usage.input_tokens === null ? "estimate" : "api";
    const inputTokens = body.usage.input_tokens ?? estimate.total;
    const outputTokens = body.usage.output_tokens ?? 0;
    // OpenRouter (`usage.cost`) and Vercel (`provider_metadata.gateway.cost`) report the billed cost.
    const reported = reportedCostUsd(body);
    const cost = opts.costMeter
      ? opts.costMeter.add(inputTokens, reported)
      : (reported ?? costUsd(inputTokens, price));
    const abstained = abstainedNames(answers);

    logger.info(
      {
        provider,
        model: body.model,
        requestId,
        latencyMs: Math.round(latencyMs),
        inputTokens,
        outputTokens,
        estimatedTokens: estimate.total,
        costUsd: cost,
        costSource: reported === undefined ? "price" : "carrier",
        usageSource,
        abstained,
      },
      "decision.response",
    );
    if (abstained.length > 0) {
      const reasons: Record<string, string> = {};
      for (const name of abstained) {
        const a = answers[name];
        if (a?.type === "abstain") reasons[name] = a.reason;
      }
      logger.warn({ provider, requestId, reasons }, "decision.abstain");
    }

    const response: DecisionResponse = {
      answers,
      model: body.model,
      provider,
      usage: { inputTokens, outputTokens },
      costUsd: cost,
      latencyMs,
      calibration: "native",
    };
    if (requestId !== undefined) response.requestId = requestId;
    return ok(response);
  }

  return { id: `${provider}:${textModel}`, capabilities, ask };
}
