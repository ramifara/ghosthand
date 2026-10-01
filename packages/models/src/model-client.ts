// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Role-based calls over the AI SDK: resolve the role's fallback chain, call each model with a
// per-attempt timeout and the caller's signal, price the usage, enforce the spend cap, and log
// role/model/tokens/latency/cost (never prompts or images).
import type { Clock, Logger } from "@ghosthand/core";
import { noopLogger, systemClock } from "@ghosthand/core";
import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type {
  FilePart,
  FinishReason,
  JSONValue,
  LanguageModelUsage,
  ModelMessage,
  ProviderMetadata,
  TextPart,
  ToolSet,
} from "ai";
import { NoObjectGeneratedError, Output, generateText as sdkGenerateText } from "ai";
import type { z } from "zod";
import type { CatalogModel, ModelCatalog } from "./catalog/model-catalog.ts";
import type { ModelUsage } from "./cost-meter.ts";
import { costForUsage, estimateInputCost, type ModelCostMeter, ZERO_USAGE } from "./cost-meter.ts";
import { mapModelError } from "./map-model-error.ts";
import type { ModelAttempt, ModelError, ModelErrorKind } from "./model-error.ts";
import { FALLBACK_KINDS } from "./model-error.ts";
import type { ModelProvider, ProviderCallOptions, ProviderRegistry } from "./providers/provider-registry.ts";
import type { RoleBinding, RoleBindings } from "./role-bindings.ts";
import { DEFAULT_ROLE_BINDINGS, resolveRoleChain } from "./role-bindings.ts";
import type { ModelRole } from "./roles.ts";

export const DEFAULT_MODEL_TIMEOUT_MS = 60_000;

export interface ModelImage {
  /** Raw bytes or base64. */
  readonly data: Uint8Array | string;
  /** e.g. `image/png`. */
  readonly mediaType: string;
  /** OpenAI image detail; `original` keeps screenshot pixels for grounding. */
  readonly detail?: "low" | "high" | "auto" | "original";
}

export interface ModelRequest {
  readonly role: ModelRole;
  readonly prompt: string;
  readonly system?: string;
  readonly images?: readonly ModelImage[];
  readonly signal?: AbortSignal;
  /** Per-attempt timeout; overrides the binding's. */
  readonly timeoutMs?: number;
  readonly maxOutputTokens?: number;
}

export interface StructuredRequest<T> extends ModelRequest {
  readonly schema: z.ZodType<T>;
  /** Name and description of the output, sent to providers that use them. */
  readonly schemaName?: string;
  readonly schemaDescription?: string;
}

export interface ModelCallResult<T> {
  readonly value: T;
  readonly role: ModelRole;
  /** `provider/model` that answered. */
  readonly model: string;
  readonly usage: ModelUsage;
  readonly costUsd: number;
  /** Latency of the successful attempt. */
  readonly latencyMs: number;
  readonly finishReason: FinishReason;
  /** Failed attempts before the one that answered, in order. */
  readonly attempts: readonly ModelAttempt[];
}

/** The model and provider an attempt is about to call. */
export interface CallTarget {
  readonly model: CatalogModel;
  readonly provider: ModelProvider;
}

/** What a plan's reader returns: the value, or why the output is unusable. */
export type PlanRead<T> = Result<T, { readonly kind: ModelErrorKind; readonly message: string }>;

export interface ToolCallOutput {
  readonly toolCalls: readonly { readonly toolName: string; readonly input: unknown }[];
  readonly text: string;
  readonly providerMetadata: ProviderMetadata | undefined;
}

/**
 * How to call one model in a role chain, chosen per model: vendor tools (native computer use) or
 * a JSON-schema answer. `prompt`/`system` replace the request's for this model only.
 */
export type CallPlan<T> =
  | {
      readonly kind: "tools";
      readonly tools: ToolSet;
      readonly toolChoice?: "auto" | "required";
      readonly prompt?: string;
      readonly system?: string;
      readonly providerOptions?: ProviderCallOptions;
      read(output: ToolCallOutput): PlanRead<T>;
    }
  | {
      readonly kind: "object";
      readonly schema: z.ZodType<unknown>;
      readonly schemaName?: string;
      readonly prompt?: string;
      readonly system?: string;
      read(value: unknown): PlanRead<T>;
    };

export interface ModelClient {
  generateStructured<T>(request: StructuredRequest<T>): Promise<Result<ModelCallResult<T>, ModelError>>;
  generateText(request: ModelRequest): Promise<Result<ModelCallResult<string>, ModelError>>;
  /** Runs the role's chain, asking `plan` how to call each model (tools or JSON). */
  generateWith<T>(
    request: ModelRequest,
    plan: (target: CallTarget) => CallPlan<T>,
  ): Promise<Result<ModelCallResult<T>, ModelError>>;
}

export interface ModelClientOptions {
  readonly catalog: ModelCatalog;
  readonly providers: ProviderRegistry;
  readonly bindings?: RoleBindings;
  readonly logger?: Logger;
  readonly costMeter?: ModelCostMeter;
  readonly clock?: Clock;
  readonly defaultTimeoutMs?: number;
}

export function toModelUsage(usage: LanguageModelUsage | undefined): ModelUsage {
  if (usage === undefined) return ZERO_USAGE;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
  };
}

function userContent(prompt: string, images: readonly ModelImage[]): Array<TextPart | FilePart> {
  const parts: Array<TextPart | FilePart> = [{ type: "text", text: prompt }];
  for (const image of images) {
    const part: FilePart = {
      type: "file",
      mediaType: image.mediaType,
      data: { type: "data", data: image.data },
    };
    if (image.detail !== undefined) part.providerOptions = { openai: { imageDetail: image.detail } };
    parts.push(part);
  }
  return parts;
}

function providerOptionsFor(
  provider: ModelProvider,
  model: CatalogModel,
  binding: RoleBinding,
  extra?: ProviderCallOptions,
): ProviderCallOptions | undefined {
  const options: ProviderCallOptions = {};
  for (const [name, values] of Object.entries(provider.callOptions ?? {})) options[name] = { ...values };
  for (const [name, values] of Object.entries(extra ?? {})) options[name] = { ...options[name], ...values };
  if (binding.reasoningEffort !== undefined && model.reasoning && provider.kind === "openai") {
    const openai: Record<string, JSONValue> = options.openai ?? {};
    openai.reasoningEffort = binding.reasoningEffort;
    options.openai = openai;
  }
  return Object.keys(options).length === 0 ? undefined : options;
}

type Outcome<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly usage: ModelUsage;
      readonly finishReason: FinishReason;
      readonly reportedCostUsd?: number | undefined;
    }
  | {
      readonly ok: false;
      readonly error: ModelError;
      readonly usage: ModelUsage;
      readonly reportedCostUsd?: number | undefined;
    };

type Mode<T> =
  | { readonly kind: "text" }
  | { readonly kind: "object"; readonly request: StructuredRequest<T> }
  | { readonly kind: "plan"; readonly plan: (target: CallTarget) => CallPlan<T> };

export function createModelClient(options: ModelClientOptions): ModelClient {
  const log = (options.logger ?? noopLogger).child({ component: "models" });
  const clock = options.clock ?? systemClock;
  const bindings = options.bindings ?? DEFAULT_ROLE_BINDINGS;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;

  async function attempt<T>(
    request: ModelRequest,
    mode: Mode<T>,
    provider: ModelProvider,
    model: CatalogModel,
    binding: RoleBinding,
    timeoutMs: number,
  ): Promise<Outcome<T>> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException(`model call timed out after ${timeoutMs} ms`, "TimeoutError"));
    }, timeoutMs);
    const onCallerAbort = (): void => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", onCallerAbort, { once: true });
    // The signal may have fired between attempts, after which no abort event comes.
    if (request.signal?.aborted === true) onCallerAbort();

    const maxOutputTokens = request.maxOutputTokens ?? binding.maxOutputTokens;
    const plan = mode.kind === "plan" ? mode.plan({ model, provider }) : undefined;
    const providerOptions = providerOptionsFor(
      provider,
      model,
      binding,
      plan?.kind === "tools" ? plan.providerOptions : undefined,
    );
    const prompt = plan?.prompt ?? request.prompt;
    const system = plan?.system ?? request.system;
    const messages: ModelMessage[] = [{ role: "user", content: userContent(prompt, request.images ?? []) }];
    const common = {
      model: provider.languageModel(model.id),
      messages,
      abortSignal: controller.signal,
      maxRetries: binding.maxRetries ?? 0,
      ...(system !== undefined ? { system } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(binding.temperature !== undefined ? { temperature: binding.temperature } : {}),
      ...(providerOptions !== undefined ? { providerOptions } : {}),
    };
    const filtered = (usage: ModelUsage, reportedCostUsd: number | undefined): Outcome<T> => ({
      ok: false,
      usage,
      reportedCostUsd,
      error: { kind: "refused", message: "the provider filtered the output" },
    });
    const fromRead = (
      read: PlanRead<T>,
      usage: ModelUsage,
      finishReason: FinishReason,
      reportedCostUsd: number | undefined,
    ): Outcome<T> =>
      read.ok
        ? { ok: true, value: read.value, usage, finishReason, reportedCostUsd }
        : {
            ok: false,
            usage,
            reportedCostUsd,
            error: { kind: read.error.kind, message: read.error.message },
          };
    try {
      if (plan?.kind === "tools") {
        const result = await sdkGenerateText({
          ...common,
          tools: plan.tools,
          toolChoice: plan.toolChoice ?? "required",
        });
        const usage = toModelUsage(result.usage);
        const reported = provider.reportedCostUsd?.(result.providerMetadata);
        if (result.finishReason === "content-filter") return filtered(usage, reported);
        const read = plan.read({
          toolCalls: result.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
          text: result.text,
          providerMetadata: result.providerMetadata,
        });
        return fromRead(read, usage, result.finishReason, reported);
      }
      const objectSpec =
        plan?.kind === "object"
          ? { schema: plan.schema, schemaName: plan.schemaName, schemaDescription: undefined }
          : mode.kind === "object"
            ? mode.request
            : undefined;
      if (objectSpec !== undefined) {
        const result = await sdkGenerateText({
          ...common,
          output: Output.object({
            schema: objectSpec.schema,
            ...(objectSpec.schemaName !== undefined ? { name: objectSpec.schemaName } : {}),
            ...(objectSpec.schemaDescription !== undefined
              ? { description: objectSpec.schemaDescription }
              : {}),
          }),
        });
        const usage = toModelUsage(result.usage);
        const reported = provider.reportedCostUsd?.(result.providerMetadata);
        if (result.finishReason === "content-filter") return filtered(usage, reported);
        // `output` throws when nothing parsed; the catch below maps that to schema_failed.
        const output: unknown = result.output;
        if (plan?.kind === "object") return fromRead(plan.read(output), usage, result.finishReason, reported);
        return {
          ok: true,
          value: output as T,
          usage,
          finishReason: result.finishReason,
          reportedCostUsd: reported,
        };
      }
      const result = await sdkGenerateText(common);
      const usage = toModelUsage(result.usage);
      const reported = provider.reportedCostUsd?.(result.providerMetadata);
      if (result.finishReason === "content-filter") return filtered(usage, reported);
      const text: unknown = result.text;
      return {
        ok: true,
        value: text as T,
        usage,
        finishReason: result.finishReason,
        reportedCostUsd: reported,
      };
    } catch (e) {
      const mapped = mapModelError(e, {
        timedOut,
        callerAborted: request.signal?.aborted === true,
        timeoutMs,
      });
      const usage = NoObjectGeneratedError.isInstance(e) ? toModelUsage(e.usage) : ZERO_USAGE;
      return { ok: false, usage, error: mapped };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  async function run<T>(
    request: ModelRequest,
    mode: Mode<T>,
  ): Promise<Result<ModelCallResult<T>, ModelError>> {
    const { role } = request;
    if (request.signal?.aborted === true)
      return err({ kind: "aborted", role, message: "aborted before the call" });

    const images = request.images ?? [];
    const chain = resolveRoleChain(options.catalog, bindings, role, { needsImages: images.length > 0 });
    if (!chain.ok) return err({ kind: "not_configured", role, message: chain.error.message });
    for (const skipped of chain.value.skipped) {
      log.warn({ role, reason: skipped.kind }, `skipping bound model: ${skipped.message}`);
    }

    const { binding } = chain.value;
    const timeoutMs = request.timeoutMs ?? binding.timeoutMs ?? defaultTimeoutMs;
    const attempts: ModelAttempt[] = [];
    let last: ModelError | undefined;

    for (const model of chain.value.models) {
      const provider = options.providers.get(model.provider);
      if (provider === undefined || !provider.configured) {
        const message =
          provider === undefined
            ? `no provider "${model.provider}" is set up`
            : `no key for "${model.provider}"`;
        attempts.push({ model: model.ref, kind: "not_configured", latencyMs: 0 });
        last = { kind: "not_configured", role, model: model.ref, message };
        log.debug({ role, model: model.ref }, message);
        continue;
      }

      const chars = request.prompt.length + (request.system?.length ?? 0);
      const capped = options.costMeter?.check(estimateInputCost(chars, images.length, model.pricing));
      if (capped !== undefined && !capped.ok) {
        log.warn(
          { role, model: model.ref, spentUsd: options.costMeter?.spentUsd },
          "model spend cap reached",
        );
        return err({ ...capped.error, role, model: model.ref, attempts });
      }

      const started = clock.now();
      const outcome = await attempt(request, mode, provider, model, binding, timeoutMs);
      const latencyMs = Math.max(0, clock.now() - started);
      // The provider's own figure (OpenRouter) beats our price-table estimate.
      const costUsd = outcome.reportedCostUsd ?? costForUsage(outcome.usage, model.pricing);
      options.costMeter?.add(costUsd, outcome.usage);

      const fields = {
        role,
        model: model.ref,
        ok: outcome.ok,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        cacheReadTokens: outcome.usage.cacheReadTokens,
        reasoningTokens: outcome.usage.reasoningTokens,
        latencyMs,
        costUsd,
        attempt: attempts.length + 1,
      };
      if (outcome.ok) {
        log.info(fields, "model.call");
        return ok({
          value: outcome.value,
          role,
          model: model.ref,
          usage: outcome.usage,
          costUsd,
          latencyMs,
          finishReason: outcome.finishReason,
          attempts,
        });
      }

      log.warn(
        { ...fields, errorKind: outcome.error.kind, status: outcome.error.status },
        "model.call failed",
      );
      attempts.push({ model: model.ref, kind: outcome.error.kind, latencyMs });
      last = { ...outcome.error, role, model: model.ref };
      if (!FALLBACK_KINDS.has(outcome.error.kind)) break;
    }

    const final: ModelError = last ?? {
      kind: "not_configured",
      role,
      message: `no model available for ${role}`,
    };
    return err({ ...final, attempts });
  }

  return {
    generateStructured: <T>(request: StructuredRequest<T>) => run<T>(request, { kind: "object", request }),
    generateText: (request: ModelRequest) => run<string>(request, { kind: "text" }),
    generateWith: <T>(request: ModelRequest, plan: (target: CallTarget) => CallPlan<T>) =>
      run<T>(request, { kind: "plan", plan }),
  };
}
