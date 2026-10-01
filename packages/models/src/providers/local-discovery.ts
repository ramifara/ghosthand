// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Finds models on local OpenAI-compatible servers with `GET {baseURL}/models`. Only the URLs it is
// given are contacted: config-provided servers plus the two well-known loopback defaults (Ollama
// on 11434, LM Studio on 1234). It never scans ports or the network.
import { z } from "zod";
import type { ModelOverride } from "../catalog/model-catalog.ts";

export interface LocalServer {
  /** Catalog provider id, e.g. `ollama`, `lmstudio`, `vllm`. */
  readonly id: string;
  /** Root serving `/models` and `/chat/completions`, e.g. `http://127.0.0.1:11434/v1`. */
  readonly baseURL: string;
  readonly apiKey?: string | undefined;
}

/** Loopback defaults probed when discovery is on. Nothing else is probed without config. */
export const DEFAULT_LOCAL_SERVERS: readonly LocalServer[] = [
  { id: "ollama", baseURL: "http://127.0.0.1:11434/v1" },
  { id: "lmstudio", baseURL: "http://127.0.0.1:1234/v1" },
];

export const DEFAULT_DISCOVERY_TIMEOUT_MS = 1_500;

export interface DiscoveredServer {
  readonly id: string;
  readonly baseURL: string;
  readonly reachable: boolean;
  /** Model ids the server lists, sorted. */
  readonly models: readonly string[];
  /** Why the server was not usable (connection refused, HTTP status, bad body). */
  readonly error?: string;
  readonly latencyMs: number;
}

export interface DiscoverOptions {
  readonly servers: readonly LocalServer[];
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

const ModelsResponse = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });

function modelsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/models`;
}

async function discoverOne(server: LocalServer, options: DiscoverOptions): Promise<DiscoveredServer> {
  const f = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => performance.now());
  const started = now();
  const base = { id: server.id, baseURL: server.baseURL };
  const latency = (): number => Math.max(0, Math.round(now() - started));
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    const key = server.apiKey?.trim();
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await f(modelsUrl(server.baseURL), {
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ...base, reachable: true, models: [], error: `HTTP ${res.status}`, latencyMs: latency() };
    }
    const parsed = ModelsResponse.safeParse(await res.json());
    if (!parsed.success) {
      return {
        ...base,
        reachable: true,
        models: [],
        error: "unexpected /models body",
        latencyMs: latency(),
      };
    }
    const models = [...new Set(parsed.data.data.map((m) => m.id))].sort();
    return { ...base, reachable: true, models, latencyMs: latency() };
  } catch (e) {
    const message = e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : e.message) : String(e);
    return { ...base, reachable: false, models: [], error: message, latencyMs: latency() };
  }
}

/** Queries every server in parallel. Never throws. */
export function discoverLocalModels(options: DiscoverOptions): Promise<DiscoveredServer[]> {
  return Promise.all(options.servers.map((s) => discoverOne(s, options)));
}

/** Conservative defaults for a discovered model the catalog knows nothing about. */
export const LOCAL_MODEL_DEFAULTS = {
  contextTokens: 32_768,
  maxOutputTokens: 4_096,
} as const;

/**
 * Catalog overrides that add discovered local models. They are text-only and free; users mark
 * vision models (`inputModalities: ["text","image"]`) and grounding conventions in config overrides,
 * which are applied after these.
 */
export function localModelOverrides(servers: readonly DiscoveredServer[]): ModelOverride[] {
  const out: ModelOverride[] = [];
  for (const server of servers) {
    for (const id of server.models) {
      out.push({
        ref: `${server.id}/${id}`,
        name: `${id} (${server.id})`,
        inputModalities: ["text"],
        outputModalities: ["text"],
        contextTokens: LOCAL_MODEL_DEFAULTS.contextTokens,
        maxOutputTokens: LOCAL_MODEL_DEFAULTS.maxOutputTokens,
        structuredOutput: true,
        toolCall: false,
        pricing: { inputPerM: 0, outputPerM: 0 },
      });
    }
  }
  return out;
}
