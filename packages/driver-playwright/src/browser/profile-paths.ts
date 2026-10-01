// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Where GhostHand keeps its browser profiles on each platform.

import { posix, win32 } from "node:path";
import type { BrowserHost } from "./host.ts";
import { readEnv } from "./host.ts";

/**
 * Root of the profile store:
 * - Linux: `$XDG_DATA_HOME/ghosthand/profiles` (default `~/.local/share/ghosthand/profiles`)
 * - Windows: `%APPDATA%\ghosthand\profiles`
 * - macOS: `~/Library/Application Support/ghosthand/profiles`
 */
export function defaultProfilesRoot(host: Pick<BrowserHost, "platform" | "env" | "homedir">): string {
  if (host.platform === "win32") {
    const appData = readEnv(host, "APPDATA") ?? win32.join(host.homedir, "AppData", "Roaming");
    return win32.join(appData, "ghosthand", "profiles");
  }
  if (host.platform === "darwin") {
    return posix.join(host.homedir, "Library", "Application Support", "ghosthand", "profiles");
  }
  const xdg = readEnv(host, "XDG_DATA_HOME");
  // The XDG spec says relative values are invalid and must be ignored.
  const dataHome =
    xdg !== undefined && posix.isAbsolute(xdg) ? xdg : posix.join(host.homedir, ".local", "share");
  return posix.join(dataHome, "ghosthand", "profiles");
}
