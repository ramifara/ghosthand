// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Where downloaded STT/VAD models live, per platform (same data root as runs and profiles).
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export type ModelsDirEnv = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
};

/**
 * Default STT models directory:
 * - `GHOSTHAND_MODELS_DIR` when set (then `<dir>/stt`),
 * - Linux and other Unix: `$XDG_DATA_HOME/ghosthand/models/stt`, falling back to `~/.local/share/...`,
 * - macOS: `~/Library/Application Support/ghosthand/models/stt`,
 * - Windows: `%APPDATA%\ghosthand\models\stt`.
 */
export function defaultSttModelsDir(opts: ModelsDirEnv = {}): string {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const override = env.GHOSTHAND_MODELS_DIR;
  if (override) return (platform === "win32" ? win32 : posix).join(override, "stt");
  if (platform === "win32") {
    const appData = env.APPDATA || win32.join(home, "AppData", "Roaming");
    return win32.join(appData, "ghosthand", "models", "stt");
  }
  if (platform === "darwin")
    return posix.join(home, "Library", "Application Support", "ghosthand", "models", "stt");
  const xdg = env.XDG_DATA_HOME;
  const dataHome = xdg && posix.isAbsolute(xdg) ? xdg : posix.join(home, ".local", "share");
  return posix.join(dataHome, "ghosthand", "models", "stt");
}
