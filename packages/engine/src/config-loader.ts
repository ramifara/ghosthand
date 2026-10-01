// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Config = defaults ← ghosthand.config.ts (cwd or --config) ← overrides. Secrets come from the env file.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ConfigError,
  err,
  GhostHandConfig,
  type GhostHandConfigInput,
  ok,
  type Result,
} from "@ghosthand/protocol";

export const CONFIG_FILE = "ghosthand.config.ts";

/** Typed helper for `ghosthand.config.ts`: `export const config = defineConfig({...})`. */
export const defineConfig = (config: GhostHandConfigInput): GhostHandConfigInput => config;

function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b)
        ? deepMerge(b as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

export interface LoadConfigOptions {
  cwd?: string;
  path?: string;
  overrides?: GhostHandConfigInput;
}

export async function loadConfig(
  opts: LoadConfigOptions = {},
): Promise<Result<GhostHandConfig, ConfigError>> {
  const path = resolve(opts.cwd ?? process.cwd(), opts.path ?? CONFIG_FILE);
  let fromFile: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const mod = (await import(pathToFileURL(path).href)) as { config?: unknown };
      if (!mod.config || typeof mod.config !== "object") {
        return err({ kind: "invalid", message: `${CONFIG_FILE} must export \`config\``, path });
      }
      fromFile = mod.config as Record<string, unknown>;
    } catch (e) {
      return err({ kind: "io", message: e instanceof Error ? e.message : String(e), path });
    }
  } else if (opts.path) {
    return err({ kind: "io", message: "config file not found", path });
  }
  const merged = deepMerge(fromFile, (opts.overrides ?? {}) as Record<string, unknown>);
  const parsed = GhostHandConfig.safeParse(merged);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err({ kind: "invalid", message: `${issue?.path.join(".")}: ${issue?.message}`, path });
  }
  return ok(parsed.data);
}
