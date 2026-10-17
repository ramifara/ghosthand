// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Composition root: config, env-file secrets, logger, run index and the decision provider.
import { execFileSync } from "node:child_process";
import { type Logger, SecretsRegistry } from "@ghosthand/core";
import {
  CARRIER_PRESETS,
  CostMeter,
  createCarrierDecisionProvider,
  DEFAULT_MODEL,
  FallbackDecisionProvider,
} from "@ghosthand/decision-typesafe";
import {
  type ConfigError,
  type DecisionCarrier,
  type DecisionProvider,
  err,
  type GhostHandConfig,
  type GhostHandConfigInput,
  ok,
  type Result,
} from "@ghosthand/protocol";
import { defaultRunsDir, openRunIndex, type RunIndex } from "@ghosthand/recorder";
import { z } from "zod";
import { loadConfig } from "./config-loader.ts";
import { createLogger } from "./create-logger.ts";
import { type EnvFile, envValue, loadEnvFile } from "./env-file.ts";

const LogLevel = z.enum(["debug", "info", "warn", "error", "silent"]);

/** Env-file keys that are configuration, not secrets for the agent to type. */
const NON_AGENT_KEYS = new Set([
  "TYPESAFE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "DEEPGRAM_API_KEY",
  "ASSEMBLYAI_API_KEY",
  "ELEVENLABS_API_KEY",
]);

/** Provider key names, including any custom `apiKeyEnv` from config. */
function configKeyNames(config: GhostHandConfig): Set<string> {
  const names = new Set(NON_AGENT_KEYS);
  if (config.decision.apiKeyEnv) names.add(config.decision.apiKeyEnv);
  if (config.decision.fallback?.apiKeyEnv) names.add(config.decision.fallback.apiKeyEnv);
  for (const s of config.models.local) if (s.apiKeyEnv) names.add(s.apiKeyEnv);
  return names;
}

export interface EngineRuntime {
  config: GhostHandConfig;
  envFile: EnvFile;
  secrets: SecretsRegistry;
  logger: Logger;
  runsDir: string;
  index: RunIndex;
  warnings: string[];
}

export interface OpenRuntimeOptions {
  cwd?: string;
  configPath?: string;
  overrides?: GhostHandConfigInput;
  envFilePath?: string;
  logLevel?: z.infer<typeof LogLevel>;
}

export async function openRuntime(
  opts: OpenRuntimeOptions = {},
): Promise<Result<EngineRuntime, ConfigError>> {
  const env = loadEnvFile(opts.envFilePath);
  if (!env.ok) return env;
  const cfg = await loadConfig({
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.configPath ? { path: opts.configPath } : {}),
    ...(opts.overrides ? { overrides: opts.overrides } : {}),
  });
  if (!cfg.ok) return cfg;
  const warnings: string[] = [];
  if (env.value.insecure) warnings.push(`${env.value.path} is readable by other users; run chmod 600 on it`);

  const secrets = new SecretsRegistry();
  for (const [k, v] of env.value.values) secrets.register(k, v);
  // GHOSTHAND_LOG_LEVEL=debug shows driver and loop timings without a code change.
  const envLevel = LogLevel.safeParse(process.env.GHOSTHAND_LOG_LEVEL);
  const logger = createLogger({
    secrets,
    level: envLevel.success ? envLevel.data : (opts.logLevel ?? "warn"),
  });
  const runsDir = cfg.value.runsDir ?? defaultRunsDir();
  const index = openRunIndex(runsDir);
  if (!index.ok) return err({ kind: "io", message: index.error.message, path: runsDir });
  return ok({
    config: cfg.value,
    envFile: env.value,
    secrets,
    logger,
    runsDir,
    index: index.value,
    warnings,
  });
}

/** Secret names the agent may type (everything in the env file except provider keys). */
export const agentSecretNames = (rt: EngineRuntime, extra: string[] = []): string[] => {
  const keys = configKeyNames(rt.config);
  return [...new Set([...[...rt.envFile.values.keys()].filter((k) => !keys.has(k)), ...extra])];
};

export interface DecisionCarrierSettings {
  readonly carrier: DecisionCarrier;
  readonly model: string;
  readonly keyEnv: string;
  readonly baseUrl?: string;
}

/** Carrier, model, key name and base URL for the primary decision carrier, defaults filled in. */
export function decisionCarrierSettings(
  config: GhostHandConfig,
  which: "primary" | "fallback" = "primary",
): DecisionCarrierSettings | undefined {
  const d = config.decision;
  const entry =
    which === "primary"
      ? { provider: d.provider, model: d.model, apiKeyEnv: d.apiKeyEnv }
      : d.fallback === undefined
        ? undefined
        : { provider: d.fallback.provider, model: d.fallback.model, apiKeyEnv: d.fallback.apiKeyEnv };
  if (entry === undefined) return undefined;
  const preset = entry.provider === "typesafe" ? undefined : CARRIER_PRESETS[entry.provider];
  return {
    carrier: entry.provider,
    model: entry.model ?? preset?.model ?? DEFAULT_MODEL,
    keyEnv: entry.apiKeyEnv ?? preset?.keyEnv ?? "TYPESAFE_API_KEY",
    // `decision.baseUrl` overrides the primary carrier only.
    ...(which === "primary" && d.baseUrl ? { baseUrl: d.baseUrl } : {}),
  };
}

/**
 * The decision provider from config: TypeSafe direct (default), Jev on OpenRouter, or Jev on the
 * Vercel AI Gateway, optionally wrapped in a failover to a second carrier. Both share one spend cap.
 */
export function createDecisionProvider(
  rt: EngineRuntime,
  capUsd: number,
  env: NodeJS.ProcessEnv = process.env,
): Result<DecisionProvider, ConfigError> {
  const d = rt.config.decision;
  const primary = decisionCarrierSettings(rt.config, "primary");
  if (primary === undefined) throw new Error("unreachable: primary decision settings");
  const apiKey = envValue(primary.keyEnv, rt.envFile, env);
  if (!apiKey) {
    return err({
      kind: "missing_key",
      message: `${primary.keyEnv} is not set (add it to ${rt.envFile.path} with mode 0600)`,
      path: rt.envFile.path,
    });
  }
  rt.secrets.register(primary.keyEnv, apiKey);
  const costMeter = new CostMeter({ capUsd, priceInputPerM: d.priceInputPerM, provider: primary.carrier });
  const logger = rt.logger.child({ pkg: "decision-typesafe" });
  const common = {
    timeoutMs: d.timeoutMs,
    retries: d.retries,
    priceInputPerM: d.priceInputPerM,
    costMeter,
    logger,
  };
  const first = createCarrierDecisionProvider(primary.carrier, {
    ...common,
    apiKey,
    model: primary.model,
    ...(d.visionModel ? { visionModel: d.visionModel } : {}),
    ...(primary.baseUrl ? { baseUrl: primary.baseUrl } : {}),
  });
  const fallback = decisionCarrierSettings(rt.config, "fallback");
  if (fallback === undefined) return ok(first);
  const fallbackKey = envValue(fallback.keyEnv, rt.envFile, env);
  if (!fallbackKey) {
    rt.warnings.push(`decision fallback ${fallback.carrier} skipped: ${fallback.keyEnv} is not set`);
    return ok(first);
  }
  rt.secrets.register(fallback.keyEnv, fallbackKey);
  const second = createCarrierDecisionProvider(fallback.carrier, {
    ...common,
    apiKey: fallbackKey,
    model: fallback.model,
    ...(d.visionModel ? { visionModel: d.visionModel } : {}),
  });
  return ok(new FallbackDecisionProvider(first, second, { logger }));
}

export function gitSha(cwd = process.cwd()): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}
