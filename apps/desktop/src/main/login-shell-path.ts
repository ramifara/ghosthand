// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A macOS app started from Finder or the Dock (and a Linux app started from a desktop file) gets a
// minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), so the user's Codex and Claude CLIs (Homebrew, npm,
// ~/.local/bin) are not found and the planner and writer silently drop out. This reads the PATH a
// login shell would have and adds the usual install folders, before the engine host is started.
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const MARK = "__GHOSTHAND_PATH__";

/** Folders CLIs are commonly installed to, in addition to the login shell's PATH. */
export function commonBinDirs(home: string, platform: NodeJS.Platform): string[] {
  const dirs = [
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".cargo", "bin"),
    "/usr/local/bin",
  ];
  if (platform === "darwin") dirs.unshift("/opt/homebrew/bin", "/opt/homebrew/sbin");
  return dirs;
}

/** PATH entries in order, without duplicates or empty entries. */
export function mergePath(...lists: Array<string | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const dir of (list ?? "").split(delimiter)) {
      const d = dir.trim();
      if (d && !seen.has(d)) {
        seen.add(d);
        out.push(d);
      }
    }
  }
  return out.join(delimiter);
}

/** The PATH printed by the user's login shell, or undefined (Windows, no shell, timeout). */
export function loginShellPath(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 4000,
): Promise<string | undefined> {
  const shell = env.SHELL;
  if (process.platform === "win32" || !shell) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", `printf '%s%s%s' '${MARK}' "$PATH" '${MARK}'`],
      { timeout: timeoutMs, env: { ...env, TERM: "dumb" }, encoding: "utf8" },
      (error, stdout) => {
        // Shell start-up files may print banners; only the marked part is the PATH.
        const parts = typeof stdout === "string" ? stdout.split(MARK) : [];
        resolve(!error || parts.length >= 3 ? parts[1] || undefined : undefined);
      },
    );
  });
}

/** Extends process.env.PATH in place (the engine host inherits it). Returns the added folders' count. */
export async function fixGuiPath(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (process.platform === "win32") return 0;
  const before = env.PATH ?? "";
  const shellPath = await loginShellPath(env);
  env.PATH = mergePath(shellPath, before, commonBinDirs(homedir(), process.platform).join(delimiter));
  return env.PATH.split(delimiter).length - before.split(delimiter).filter(Boolean).length;
}
