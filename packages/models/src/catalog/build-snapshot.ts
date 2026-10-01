// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Trims the models.dev catalog to the providers, models and fields GhostHand uses. Pure, so the
// snapshot script stays I/O only and the selection rules are unit-tested.
import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { CatalogError } from "./catalog-error.ts";
import type { ModelsSnapshot, SnapshotModel, SnapshotProvider } from "./snapshot-schema.ts";
import { ModelsDevApi, ModelsDevModel, ModelsDevProvider } from "./snapshot-schema.ts";

export interface SnapshotSelection {
  /** models.dev provider ids to keep. */
  readonly providers: readonly string[];
  /** For aggregators (OpenRouter), keep only these upstream vendors (the part before the slash). */
  readonly aggregatorVendors: readonly string[];
  /** For aggregators, keep only models released on or after this ISO date. */
  readonly aggregatorSince: string;
}

export const AGGREGATOR_PROVIDERS: ReadonlySet<string> = new Set(["openrouter"]);

export const DEFAULT_SNAPSHOT_SELECTION: SnapshotSelection = {
  providers: ["openai", "anthropic", "google", "openrouter"],
  aggregatorVendors: [
    "openai",
    "anthropic",
    "google",
    "x-ai",
    "deepseek",
    "qwen",
    "moonshotai",
    "z-ai",
    "mistralai",
    "meta-llama",
  ],
  aggregatorSince: "2025-09-01",
};

export const MODELS_DEV_ATTRIBUTION =
  "Model data from models.dev (https://github.com/sst/models.dev), MIT License, Copyright (c) 2025 models.dev";

/** Chat models only: text in, text out, tool calling, not deprecated. */
export function isChatModel(model: ModelsDevModel): boolean {
  const output = model.modalities?.output ?? [];
  const input = model.modalities?.input ?? [];
  return (
    model.tool_call === true &&
    model.status !== "deprecated" &&
    input.includes("text") &&
    output.length === 1 &&
    output[0] === "text" &&
    (model.limit?.context ?? 0) > 0
  );
}

function keepForProvider(providerId: string, model: ModelsDevModel, selection: SnapshotSelection): boolean {
  if (!isChatModel(model)) return false;
  if (!AGGREGATOR_PROVIDERS.has(providerId)) return true;
  const vendor = model.id.split("/")[0] ?? "";
  if (!selection.aggregatorVendors.includes(vendor)) return false;
  return (model.release_date ?? "") >= selection.aggregatorSince;
}

export function trimModel(model: ModelsDevModel): SnapshotModel {
  const out: SnapshotModel = {
    name: model.name,
    modalities: { input: model.modalities?.input ?? ["text"], output: model.modalities?.output ?? ["text"] },
    limit: { context: model.limit?.context ?? 0, output: model.limit?.output ?? 0 },
    tool_call: model.tool_call ?? false,
    reasoning: model.reasoning ?? false,
  };
  if (model.family !== undefined) out.family = model.family;
  const cost = model.cost;
  if (cost?.input !== undefined && cost.output !== undefined) {
    out.cost = { input: cost.input, output: cost.output };
    if (cost.cache_read !== undefined) out.cost.cache_read = cost.cache_read;
    if (cost.cache_write !== undefined) out.cost.cache_write = cost.cache_write;
  }
  if (model.structured_output !== undefined) out.structured_output = model.structured_output;
  if (model.release_date !== undefined) out.release_date = model.release_date;
  if (model.status === "alpha" || model.status === "beta") out.status = model.status;
  return out;
}

export interface BuildSnapshotOptions {
  readonly source: string;
  readonly generatedAt: string;
  readonly selection?: SnapshotSelection;
}

/** Builds a snapshot from parsed `api.json` content. Providers and models come out sorted by id. */
export function buildModelsSnapshot(
  api: unknown,
  options: BuildSnapshotOptions,
): Result<ModelsSnapshot, CatalogError> {
  const selection = options.selection ?? DEFAULT_SNAPSHOT_SELECTION;
  const root = ModelsDevApi.safeParse(api);
  if (!root.success) return err({ kind: "invalid", message: "models.dev api.json is not an object" });

  const providers: Record<string, SnapshotProvider> = {};
  for (const providerId of [...selection.providers].sort()) {
    const rawProvider = root.data[providerId];
    if (rawProvider === undefined) {
      return err({ kind: "invalid", message: `provider "${providerId}" missing from models.dev data` });
    }
    const provider = ModelsDevProvider.safeParse(rawProvider);
    if (!provider.success) {
      return err({ kind: "invalid", message: provider.error.message, path: providerId });
    }
    const models: Record<string, SnapshotModel> = {};
    for (const modelId of Object.keys(provider.data.models).sort()) {
      const parsed = ModelsDevModel.safeParse(provider.data.models[modelId]);
      if (!parsed.success) {
        return err({
          kind: "invalid",
          message: parsed.error.message,
          path: `${providerId}.models.${modelId}`,
        });
      }
      if (keepForProvider(providerId, parsed.data, selection)) models[modelId] = trimModel(parsed.data);
    }
    const out: SnapshotProvider = { name: provider.data.name, env: provider.data.env, models };
    if (provider.data.npm !== undefined) out.npm = provider.data.npm;
    if (provider.data.api !== undefined) out.api = provider.data.api;
    if (provider.data.doc !== undefined) out.doc = provider.data.doc;
    providers[providerId] = out;
  }
  return ok({
    schemaVersion: 1,
    source: options.source,
    generatedAt: options.generatedAt,
    attribution: MODELS_DEV_ATTRIBUTION,
    providers,
  });
}
