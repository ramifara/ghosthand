// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Names (never values) of keys set in ~/.config/ghosthand/env. The engine reads that file too, so a key there
// counts as configured even when it was never entered in Settings.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function envFileKeyNames(env: NodeJS.ProcessEnv = process.env): string[] {
  const base =
    env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0 ? env.XDG_CONFIG_HOME : join(homedir(), ".config");
  const path = env.GHOSTHAND_ENV_FILE ?? join(base, "ghosthand", "env");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m?.[1]) continue;
    const value = (m[2] ?? "").trim().replace(/^["']|["']$/g, "");
    if (value.length > 0) names.push(m[1]);
  }
  return names;
}
