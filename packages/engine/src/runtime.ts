// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Composition root: config, env-file secrets, logger, run index and the decision provider.
import { execFileSync } from "node:child_process";
import { type Logger, SecretsRegistry } from "@ghosthand/core";
import { CostMeter, createTypeSafeDecisionProvider } from "@ghosthand/decision-typesafe";
import {
  type ConfigError,
  type DecisionProvider,
  err,
  type GhostHandConfig,
  type GhostHandConfigInput,
  ok,
  type Result,
} from "@ghosthand/protocol";
import { defaultRunsDir, openRunIndex, type RunIndex } from "@ghosthand/recorder";
import { loadConfig } from "./config-loader.ts";
import { createLogger } from "./create-logger.ts";
import { type EnvFile, envValue, loadEnvFile } from "./env-file.ts";

/** Env-file keys that are configuration, not secrets for the agent to type. */
const NON_AGENT_KEYS = new Set([
  "TYPESAFE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
]);

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
  logLevel?: "debug" | "info" | "warn" | "error" | "silent";
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
  const logger = createLogger({ secrets, level: opts.logLevel ?? "warn" });
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
export const agentSecretNames = (rt: EngineRuntime, extra: string[] = []): string[] => [
  ...new Set([...[...rt.envFile.values.keys()].filter((k) => !NON_AGENT_KEYS.has(k)), ...extra]),
];

export function createDecisionProvider(
  rt: EngineRuntime,
  capUsd: number,
): Result<DecisionProvider, ConfigError> {
  const apiKey = envValue("TYPESAFE_API_KEY", rt.envFile);
  if (!apiKey) {
    return err({
      kind: "missing_key",
      message: `TYPESAFE_API_KEY is not set (add it to ${rt.envFile.path} with mode 0600)`,
      path: rt.envFile.path,
    });
  }
  rt.secrets.register("TYPESAFE_API_KEY", apiKey);
  const d = rt.config.decision;
  return ok(
    createTypeSafeDecisionProvider({
      apiKey,
      model: d.model,
      timeoutMs: d.timeoutMs,
      retries: d.retries,
      priceInputPerM: d.priceInputPerM,
      ...(d.baseUrl ? { baseUrl: d.baseUrl } : {}),
      costMeter: new CostMeter({ capUsd, priceInputPerM: d.priceInputPerM }),
      logger: rt.logger.child({ pkg: "decision-typesafe" }),
    }),
  );
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
