// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Where run folders live by default, per platform.
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export type RunsDirEnv = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
};

/**
 * Default runs directory:
 * - `GHOSTHAND_RUNS_DIR` when set (also read by `secrets:check`),
 * - Linux and other Unix: `$XDG_DATA_HOME/ghosthand/runs`, falling back to `~/.local/share/ghosthand/runs`,
 * - macOS: `~/Library/Application Support/ghosthand/runs`,
 * - Windows: `%APPDATA%\ghosthand\runs`, falling back to `~\AppData\Roaming\ghosthand\runs`.
 * Callers can always pass an explicit `runsDir` instead.
 */
export function defaultRunsDir(opts: RunsDirEnv = {}): string {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const override = env.GHOSTHAND_RUNS_DIR;
  if (override) return override;
  if (platform === "win32") {
    const appData = env.APPDATA || win32.join(home, "AppData", "Roaming");
    return win32.join(appData, "ghosthand", "runs");
  }
  if (platform === "darwin") return posix.join(home, "Library", "Application Support", "ghosthand", "runs");
  const xdg = env.XDG_DATA_HOME;
  const dataHome = xdg && posix.isAbsolute(xdg) ? xdg : posix.join(home, ".local", "share");
  return posix.join(dataHome, "ghosthand", "runs");
}
