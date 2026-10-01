// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The model catalog: the committed models.dev snapshot, then our built-in fields, then user
// overrides from config. Later layers win field by field.
import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import { z } from "zod";
import { parseModelRef } from "../model-ref.ts";
import type { CatalogError } from "./catalog-error.ts";
import type { GhostHandFields } from "./ghosthand-fields.ts";
import { BUILTIN_GHOSTHAND_FIELDS, GroundingConvention, NativeComputerTool } from "./ghosthand-fields.ts";
import bundled from "./models-snapshot.json" with { type: "json" };
import type { SnapshotModel } from "./snapshot-schema.ts";
import { ModelsSnapshot } from "./snapshot-schema.ts";

export interface ModelPricing {
  /** USD per million input tokens that were not served from cache. */
  readonly inputPerM: number;
  readonly outputPerM: number;
  readonly cacheReadPerM?: number;
  readonly cacheWritePerM?: number;
}

export type CatalogSource = "models.dev" | "builtin" | "override";

export interface CatalogModel {
  /** `provider/model`. */
  readonly ref: string;
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly family?: string;
  readonly inputModalities: readonly string[];
  readonly outputModalities: readonly string[];
  readonly contextTokens: number;
  readonly maxOutputTokens: number;
  readonly pricing?: ModelPricing;
  readonly toolCall: boolean;
  readonly structuredOutput: boolean;
  readonly reasoning: boolean;
  readonly releaseDate?: string;
  readonly status?: "alpha" | "beta";
  readonly computerUse?: NativeComputerTool;
  readonly grounding: GroundingConvention;
  readonly latencyP50Ms?: number;
  readonly sources: readonly CatalogSource[];
}

export interface CatalogProvider {
  readonly id: string;
  readonly name: string;
  /** Environment variable names that hold the provider's key, per models.dev. */
  readonly env: readonly string[];
  readonly npm?: string;
  readonly api?: string;
}

/** A user override for one model, from config. Adds the model when it is not in the snapshot. */
export const ModelOverride = z
  .object({
    ref: z.string().refine((r) => parseModelRef(r) !== undefined, "expected provider/model"),
    name: z.string().optional(),
    family: z.string().optional(),
    inputModalities: z.array(z.string()).optional(),
    outputModalities: z.array(z.string()).optional(),
    contextTokens: z.number().int().nonnegative().optional(),
    maxOutputTokens: z.number().int().nonnegative().optional(),
    pricing: z
      .object({
        inputPerM: z.number().nonnegative(),
        outputPerM: z.number().nonnegative(),
        cacheReadPerM: z.number().nonnegative(),
        cacheWritePerM: z.number().nonnegative(),
      })
      .partial()
      .optional(),
    toolCall: z.boolean().optional(),
    structuredOutput: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    releaseDate: z.string().optional(),
    /** `null` clears a built-in value. */
    computerUse: NativeComputerTool.nullable().optional(),
    grounding: GroundingConvention.optional(),
    latencyP50Ms: z.number().nonnegative().optional(),
  })
  .strict();
export type ModelOverride = z.infer<typeof ModelOverride>;

export const CatalogOverrides = z.array(ModelOverride);

export interface ModelCatalog {
  readonly source: string;
  readonly generatedAt: string;
  get(ref: string): CatalogModel | undefined;
  /** All models, sorted by ref. */
  list(): readonly CatalogModel[];
  provider(id: string): CatalogProvider | undefined;
  providers(): readonly CatalogProvider[];
}

export interface CreateCatalogOptions {
  /** Snapshot content; defaults to the bundled snapshot. */
  readonly snapshot?: unknown;
  /** User overrides (unvalidated config input). */
  readonly overrides?: unknown;
  /** Our built-in fields; tests pass `{}` to see the raw snapshot. */
  readonly builtin?: Readonly<Record<string, GhostHandFields>>;
}

let bundledCache: ModelsSnapshot | undefined;

/** The snapshot committed with this package. Throws if it does not parse, which is a build error. */
export function bundledSnapshot(): ModelsSnapshot {
  bundledCache ??= ModelsSnapshot.parse(bundled);
  return bundledCache;
}

type MutableModel = { -readonly [K in keyof CatalogModel]: CatalogModel[K] };

function fromSnapshot(provider: string, id: string, m: SnapshotModel): MutableModel {
  const model: MutableModel = {
    ref: `${provider}/${id}`,
    provider,
    id,
    name: m.name,
    inputModalities: m.modalities.input,
    outputModalities: m.modalities.output,
    contextTokens: m.limit.context,
    maxOutputTokens: m.limit.output,
    toolCall: m.tool_call,
    structuredOutput: m.structured_output ?? false,
    reasoning: m.reasoning,
    grounding: "none",
    sources: ["models.dev"],
  };
  if (m.family !== undefined) model.family = m.family;
  if (m.release_date !== undefined) model.releaseDate = m.release_date;
  if (m.status !== undefined) model.status = m.status;
  if (m.cost !== undefined) {
    const pricing: { -readonly [K in keyof ModelPricing]: ModelPricing[K] } = {
      inputPerM: m.cost.input,
      outputPerM: m.cost.output,
    };
    if (m.cost.cache_read !== undefined) pricing.cacheReadPerM = m.cost.cache_read;
    if (m.cost.cache_write !== undefined) pricing.cacheWritePerM = m.cost.cache_write;
    model.pricing = pricing;
  }
  return model;
}

function blank(provider: string, id: string): MutableModel {
  return {
    ref: `${provider}/${id}`,
    provider,
    id,
    name: id,
    inputModalities: ["text"],
    outputModalities: ["text"],
    contextTokens: 0,
    maxOutputTokens: 0,
    toolCall: false,
    structuredOutput: false,
    reasoning: false,
    grounding: "none",
    sources: [],
  };
}

function applyFields(model: MutableModel, fields: GhostHandFields): void {
  if (fields.computerUse !== undefined) model.computerUse = fields.computerUse;
  if (fields.grounding !== undefined) model.grounding = fields.grounding;
  if (fields.latencyP50Ms !== undefined) model.latencyP50Ms = fields.latencyP50Ms;
  model.sources = [...model.sources, "builtin"];
}

function applyOverride(model: MutableModel, o: ModelOverride): void {
  if (o.name !== undefined) model.name = o.name;
  if (o.family !== undefined) model.family = o.family;
  if (o.inputModalities !== undefined) model.inputModalities = o.inputModalities;
  if (o.outputModalities !== undefined) model.outputModalities = o.outputModalities;
  if (o.contextTokens !== undefined) model.contextTokens = o.contextTokens;
  if (o.maxOutputTokens !== undefined) model.maxOutputTokens = o.maxOutputTokens;
  if (o.toolCall !== undefined) model.toolCall = o.toolCall;
  if (o.structuredOutput !== undefined) model.structuredOutput = o.structuredOutput;
  if (o.reasoning !== undefined) model.reasoning = o.reasoning;
  if (o.releaseDate !== undefined) model.releaseDate = o.releaseDate;
  if (o.grounding !== undefined) model.grounding = o.grounding;
  if (o.latencyP50Ms !== undefined) model.latencyP50Ms = o.latencyP50Ms;
  if (o.computerUse === null) delete model.computerUse;
  else if (o.computerUse !== undefined) model.computerUse = o.computerUse;
  if (o.pricing !== undefined) {
    const base = model.pricing;
    const inputPerM = o.pricing.inputPerM ?? base?.inputPerM;
    const outputPerM = o.pricing.outputPerM ?? base?.outputPerM;
    if (inputPerM !== undefined && outputPerM !== undefined) {
      const pricing: { -readonly [K in keyof ModelPricing]: ModelPricing[K] } = { inputPerM, outputPerM };
      const cacheRead = o.pricing.cacheReadPerM ?? base?.cacheReadPerM;
      const cacheWrite = o.pricing.cacheWritePerM ?? base?.cacheWritePerM;
      if (cacheRead !== undefined) pricing.cacheReadPerM = cacheRead;
      if (cacheWrite !== undefined) pricing.cacheWritePerM = cacheWrite;
      model.pricing = pricing;
    }
  }
  model.sources = [...model.sources, "override"];
}

function issuePath(error: z.ZodError): string | undefined {
  const path = error.issues[0]?.path;
  return path === undefined || path.length === 0 ? undefined : path.map(String).join(".");
}

export function createModelCatalog(options: CreateCatalogOptions = {}): Result<ModelCatalog, CatalogError> {
  let snapshot: ModelsSnapshot;
  if (options.snapshot === undefined) {
    snapshot = bundledSnapshot();
  } else {
    const parsed = ModelsSnapshot.safeParse(options.snapshot);
    if (!parsed.success) {
      const path = issuePath(parsed.error);
      return err({
        kind: "invalid",
        message: `snapshot: ${parsed.error.message}`,
        ...(path ? { path } : {}),
      });
    }
    snapshot = parsed.data;
  }
  const overrides = CatalogOverrides.safeParse(options.overrides ?? []);
  if (!overrides.success) {
    const path = issuePath(overrides.error);
    return err({
      kind: "invalid",
      message: `model overrides: ${overrides.error.message}`,
      ...(path ? { path: `overrides.${path}` } : {}),
    });
  }

  const providers = new Map<string, CatalogProvider>();
  const models = new Map<string, MutableModel>();
  for (const [providerId, provider] of Object.entries(snapshot.providers)) {
    const entry: { -readonly [K in keyof CatalogProvider]: CatalogProvider[K] } = {
      id: providerId,
      name: provider.name,
      env: provider.env,
    };
    if (provider.npm !== undefined) entry.npm = provider.npm;
    if (provider.api !== undefined) entry.api = provider.api;
    providers.set(providerId, entry);
    for (const [modelId, model] of Object.entries(provider.models)) {
      const m = fromSnapshot(providerId, modelId, model);
      models.set(m.ref, m);
    }
  }
  for (const [ref, fields] of Object.entries(options.builtin ?? BUILTIN_GHOSTHAND_FIELDS)) {
    const model = models.get(ref);
    if (model !== undefined) applyFields(model, fields);
  }
  for (const o of overrides.data) {
    const parsedRef = parseModelRef(o.ref);
    if (parsedRef === undefined) continue; // unreachable: the schema refines the ref
    let model = models.get(o.ref);
    if (model === undefined) {
      model = blank(parsedRef.provider, parsedRef.model);
      models.set(o.ref, model);
    }
    if (!providers.has(parsedRef.provider)) {
      providers.set(parsedRef.provider, { id: parsedRef.provider, name: parsedRef.provider, env: [] });
    }
    applyOverride(model, o);
  }

  const sorted: readonly CatalogModel[] = [...models.values()].sort((a, b) => a.ref.localeCompare(b.ref));
  const providerList: readonly CatalogProvider[] = [...providers.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  return ok({
    source: snapshot.source,
    generatedAt: snapshot.generatedAt,
    get: (ref) => models.get(ref),
    list: () => sorted,
    provider: (id) => providers.get(id),
    providers: () => providerList,
  });
}
