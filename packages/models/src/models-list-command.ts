// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The function behind `ghosthand models list`. It returns data plus a table; apps/cli parses
// arguments and prints. Keys are only checked for presence and never printed.

import type { NativeComputerTool } from "./catalog/ghosthand-fields.ts";
import type { CatalogModel, ModelCatalog, ModelPricing } from "./catalog/model-catalog.ts";
import { createModelCatalog } from "./catalog/model-catalog.ts";
import { IMPLEMENTED_PROVIDER_KINDS } from "./providers/provider-registry.ts";
import { compatibleRoles } from "./role-bindings.ts";
import type { ChatRole } from "./roles.ts";
import { CHAT_ROLES, ROLE_BADGES } from "./roles.ts";

export interface CommandOutput<T> {
  readonly data: T;
  readonly text: string;
}

/**
 * `set`: a key is present. `missing`: callable once a key is added. `local`: a local server that
 * needs no key. `unsupported`: no provider yet.
 */
export type KeyStatus = "set" | "missing" | "local" | "unsupported";

export interface ModelsListEntry {
  readonly ref: string;
  readonly name: string;
  readonly provider: string;
  readonly contextTokens: number;
  readonly maxOutputTokens: number;
  readonly pricing?: ModelPricing;
  readonly roles: readonly ChatRole[];
  readonly computerUse?: NativeComputerTool;
  readonly releaseDate?: string;
  readonly key: KeyStatus;
}

export interface ModelsListOptions {
  /** Defaults to the bundled snapshot with built-in fields. */
  readonly catalog?: ModelCatalog;
  /** Environment values from the engine's env file; only presence is checked. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Only this provider. */
  readonly provider?: string;
  /** Only models that can serve this role. */
  readonly role?: ChatRole;
  /** Include providers GhostHand cannot call (catalog entries with no factory). */
  readonly all?: boolean;
  /** Provider ids of local OpenAI-compatible servers (discovered or configured); they need no key. */
  readonly localProviders?: readonly string[];
}

function isImplemented(provider: string, local: readonly string[]): boolean {
  return local.includes(provider) || (IMPLEMENTED_PROVIDER_KINDS as ReadonlySet<string>).has(provider);
}

function keyStatus(
  provider: string,
  catalog: ModelCatalog,
  env: ModelsListOptions["env"],
  local: readonly string[],
): KeyStatus {
  if (local.includes(provider)) return "local";
  if (!isImplemented(provider, local)) return "unsupported";
  const names = catalog.provider(provider)?.env ?? [];
  return names.some((name) => (env?.[name]?.trim() ?? "") !== "") ? "set" : "missing";
}

function toEntry(model: CatalogModel, key: KeyStatus): ModelsListEntry {
  const entry: { -readonly [K in keyof ModelsListEntry]: ModelsListEntry[K] } = {
    ref: model.ref,
    name: model.name,
    provider: model.provider,
    contextTokens: model.contextTokens,
    maxOutputTokens: model.maxOutputTokens,
    roles: compatibleRoles(model),
    key,
  };
  if (model.pricing !== undefined) entry.pricing = model.pricing;
  if (model.computerUse !== undefined) entry.computerUse = model.computerUse;
  if (model.releaseDate !== undefined) entry.releaseDate = model.releaseDate;
  return entry;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function formatPrice(n: number | undefined): string {
  return n === undefined ? "-" : n.toFixed(2);
}

export function formatModelsTable(entries: readonly ModelsListEntry[], source: string): string {
  if (entries.length === 0) return "No models match.";
  const refWidth = Math.max(5, ...entries.map((e) => e.ref.length));
  const badgeWidth = CHAT_ROLES.map((r) => ROLE_BADGES[r]).join(" ").length;
  const header =
    `${"MODEL".padEnd(refWidth)}  ${"CONTEXT".padStart(7)}  ${"IN $/M".padStart(7)}  ${"OUT $/M".padStart(7)}  ` +
    `${"ROLES".padEnd(badgeWidth)}  CU  KEY`;
  const rows = entries.map((e) => {
    const badges = CHAT_ROLES.map((r) =>
      e.roles.includes(r) ? ROLE_BADGES[r] : " ".repeat(ROLE_BADGES[r].length),
    );
    return (
      `${e.ref.padEnd(refWidth)}  ${formatTokens(e.contextTokens).padStart(7)}  ` +
      `${formatPrice(e.pricing?.inputPerM).padStart(7)}  ${formatPrice(e.pricing?.outputPerM).padStart(7)}  ` +
      `${badges.join(" ")}  ${(e.computerUse !== undefined ? "yes" : "").padEnd(3)} ${e.key}`
    );
  });
  const legend =
    "Roles: P planner, W writer, VR vision_reviewer, VG vision_grounder, J judge. " +
    "CU: native computer-use tool. Prices in USD per million tokens.";
  return [header, ...rows.map((r) => r.trimEnd()), "", legend, `Catalog: ${source}`].join("\n");
}

/** Lists catalog models, newest first within each provider. */
export function modelsListCommand(
  options: ModelsListOptions = {},
): CommandOutput<readonly ModelsListEntry[]> {
  let catalog = options.catalog;
  if (catalog === undefined) {
    const created = createModelCatalog();
    // The bundled snapshot is validated by tests; failing here is a build error.
    if (!created.ok) throw new Error(`bundled model catalog is invalid: ${created.error.message}`);
    catalog = created.value;
  }
  const local = options.localProviders ?? [];
  const models = catalog
    .list()
    .filter((m) => options.all === true || isImplemented(m.provider, local))
    .filter((m) => options.provider === undefined || m.provider === options.provider)
    .map((m) => toEntry(m, keyStatus(m.provider, catalog, options.env, local)))
    .filter((e) => options.role === undefined || e.roles.includes(options.role))
    .sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) ||
        (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") ||
        a.ref.localeCompare(b.ref),
    );
  return { data: models, text: formatModelsTable(models, `${catalog.source} (${catalog.generatedAt})`) };
}
