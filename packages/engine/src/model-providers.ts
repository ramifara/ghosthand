// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Which model providers this machine can use: keys from the env file (OpenAI, Anthropic, Google,
// OpenRouter) and local OpenAI-compatible servers found by discovery. Builds the catalog (with
// discovered local models), the provider registry and the role bindings for the models layer.
import {
  createAnthropicProvider,
  createGoogleProvider,
  createModelCatalog,
  createOpenAICompatibleProvider,
  createOpenAIProvider,
  createOpenRouterProvider,
  createProviderRegistry,
  DEFAULT_LOCAL_SERVERS,
  type DiscoveredServer,
  defaultRoleBindingsFor,
  discoverLocalModels,
  type LocalServer,
  localModelOverrides,
  type ModelCatalog,
  type ModelProvider,
  type ModelsListEntry,
  modelsListCommand,
  type ProviderRegistry,
  parseRoleBindings,
  type RoleBindings,
} from "@ghosthand/models";
import { envValue } from "./env-file.ts";
import type { EngineRuntime } from "./runtime.ts";

/** Env-file names per hosted provider, first match wins. */
export const PROVIDER_KEY_ENV: Readonly<Record<string, readonly string[]>> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};

export interface ProviderKey {
  readonly provider: string;
  /** Env var the key came from, when present. */
  readonly env?: string;
  readonly key?: string;
}

export interface ModelsSetupOptions {
  /** Contact local servers (loopback defaults and configured URLs). Default true. */
  readonly discover?: boolean;
  readonly fetch?: typeof globalThis.fetch;
  /** Process environment (tests pass their own). Default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
}

export interface ModelsSetup {
  readonly catalog: ModelCatalog;
  readonly registry: ProviderRegistry;
  /** Hosted providers with a key, in PROVIDER_KEY_ENV order. */
  readonly keyed: readonly string[];
  /** Every local server that was probed. */
  readonly local: readonly DiscoveredServer[];
  /** Ids of reachable local servers that listed models. */
  readonly localProviders: readonly string[];
  readonly bindings: RoleBindings;
  readonly warnings: readonly string[];
}

export function providerKeys(rt: EngineRuntime, env: NodeJS.ProcessEnv = process.env): ProviderKey[] {
  return Object.entries(PROVIDER_KEY_ENV).map(([provider, names]) => {
    for (const name of names) {
      const key = envValue(name, rt.envFile, env)?.trim();
      if (key) return { provider, env: name, key };
    }
    return { provider };
  });
}

/** Configured servers plus, when discovery is on, the loopback defaults not overridden by id. */
export function localServers(rt: EngineRuntime, env: NodeJS.ProcessEnv = process.env): LocalServer[] {
  const configured: LocalServer[] = rt.config.models.local.map((s) => ({
    id: s.id,
    baseURL: s.baseUrl,
    ...(s.apiKeyEnv === undefined ? {} : { apiKey: envValue(s.apiKeyEnv, rt.envFile, env) }),
  }));
  if (!rt.config.models.discoverLocal) return configured;
  const ids = new Set(configured.map((s) => s.id));
  return [...configured, ...DEFAULT_LOCAL_SERVERS.filter((s) => !ids.has(s.id))];
}

function hostedProvider(k: ProviderKey): ModelProvider | undefined {
  switch (k.provider) {
    case "openai":
      return createOpenAIProvider({ apiKey: k.key });
    case "anthropic":
      return createAnthropicProvider({ apiKey: k.key });
    case "google":
      return createGoogleProvider({ apiKey: k.key });
    case "openrouter":
      return createOpenRouterProvider({ apiKey: k.key });
    default:
      return undefined;
  }
}

export async function setupModels(rt: EngineRuntime, opts: ModelsSetupOptions = {}): Promise<ModelsSetup> {
  const env = opts.env ?? process.env;
  const warnings: string[] = [];
  const keys = providerKeys(rt, env);
  for (const k of keys) if (k.env && k.key) rt.secrets.register(k.env, k.key);

  const servers = localServers(rt, env);
  for (const s of servers) if (s.apiKey) rt.secrets.register(`LOCAL_${s.id.toUpperCase()}_KEY`, s.apiKey);
  const local =
    opts.discover === false || servers.length === 0
      ? []
      : await discoverLocalModels({ servers, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const usable = local.filter((s) => s.reachable && s.models.length > 0);
  const localProviders = usable.map((s) => s.id);

  const catalog = createModelCatalog({
    overrides: [...localModelOverrides(usable), ...(rt.config.models.overrides ?? [])],
  });
  if (!catalog.ok) {
    warnings.push(`model overrides ignored: ${catalog.error.message}`);
  }
  const fallbackCatalog = createModelCatalog({ overrides: localModelOverrides(usable) });
  const finalCatalog = catalog.ok ? catalog.value : fallbackCatalog.ok ? fallbackCatalog.value : undefined;
  if (finalCatalog === undefined) throw new Error("bundled model catalog is invalid");

  const providers: ModelProvider[] = keys.flatMap((k) => {
    const p = hostedProvider(k);
    return p === undefined ? [] : [p];
  });
  for (const s of usable) {
    const server = servers.find((x) => x.id === s.id);
    providers.push(
      createOpenAICompatibleProvider({
        id: s.id,
        baseURL: s.baseURL,
        ...(server?.apiKey ? { apiKey: server.apiKey } : {}),
      }),
    );
  }
  const keyed = keys.filter((k) => k.key !== undefined).map((k) => k.provider);

  let bindings = defaultRoleBindingsFor(keyed);
  if (rt.config.models.roles !== undefined) {
    const parsed = parseRoleBindings(rt.config.models.roles);
    if (parsed.ok) bindings = parsed.value;
    else warnings.push(`models.roles ignored: ${parsed.error.message}`);
  }
  return {
    catalog: finalCatalog,
    registry: createProviderRegistry(providers),
    keyed,
    local,
    localProviders,
    bindings,
    warnings,
  };
}

export interface ListModelsOptions extends ModelsSetupOptions {
  readonly provider?: string;
  readonly role?: "planner" | "writer" | "vision_reviewer" | "vision_grounder" | "judge";
  readonly all?: boolean;
}

/** `ghosthand models list`: the catalog with discovered local models and key presence per provider. */
export async function listModels(
  rt: EngineRuntime,
  opts: ListModelsOptions = {},
): Promise<{ data: readonly ModelsListEntry[]; text: string; local: readonly DiscoveredServer[] }> {
  const setup = await setupModels(rt, opts);
  // Presence only: modelsListCommand never sees key values.
  const presence: Record<string, string> = {};
  for (const k of providerKeys(rt, opts.env ?? process.env)) {
    if (k.env) presence[k.env] = "set";
  }
  const out = modelsListCommand({
    catalog: setup.catalog,
    env: presence,
    localProviders: setup.localProviders,
    ...(opts.provider === undefined ? {} : { provider: opts.provider }),
    ...(opts.role === undefined ? {} : { role: opts.role }),
    ...(opts.all === undefined ? {} : { all: opts.all }),
  });
  const localLines = setup.local.map((s) =>
    s.reachable && s.models.length > 0
      ? `local ${s.id}: ${s.models.length} model(s) at ${s.baseURL}`
      : `local ${s.id}: not available at ${s.baseURL}${s.error ? ` (${s.error})` : ""}`,
  );
  return {
    data: out.data,
    text: [out.text, ...localLines, ...setup.warnings].join("\n"),
    local: setup.local,
  };
}
