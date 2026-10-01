// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Loads ~/.config/ghosthand/env (KEY=VALUE lines, mode 0600) for CLI and development secrets.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ConfigError, err, ok, type Result } from "@ghosthand/protocol";

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const base =
    env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0 ? env.XDG_CONFIG_HOME : join(homedir(), ".config");
  return join(base, "ghosthand");
}

export const defaultEnvFile = (env: NodeJS.ProcessEnv = process.env): string =>
  env.GHOSTHAND_ENV_FILE ?? join(configDir(env), "env");

export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m?.[1]) continue;
    let value = (m[2] ?? "").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.set(m[1], value);
  }
  return out;
}

export interface EnvFile {
  path: string;
  values: Map<string, string>;
  /** Set when the file is readable by group or others. */
  insecure: boolean;
}

/** Missing file → empty values (not an error). */
export function loadEnvFile(path = defaultEnvFile()): Result<EnvFile, ConfigError> {
  if (!existsSync(path)) return ok({ path, values: new Map(), insecure: false });
  try {
    const mode = statSync(path).mode & 0o777;
    const values = parseEnv(readFileSync(path, "utf8"));
    return ok({ path, values, insecure: process.platform !== "win32" && (mode & 0o077) !== 0 });
  } catch (e) {
    return err({ kind: "io", message: e instanceof Error ? e.message : String(e), path });
  }
}

/** Process env wins over the file. */
export function envValue(
  name: string,
  file: EnvFile | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const v = env[name];
  if (v !== undefined && v.length > 0) return v;
  return file?.values.get(name);
}
