// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The slice of the operating system that browser detection and profile paths read.
// Injected so the pure logic can be unit-tested with a fake filesystem and platform.

import { execFile } from "node:child_process";
import { accessSync, constants, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type HostPlatform = "linux" | "win32" | "darwin";

export interface BrowserHost {
  readonly platform: HostPlatform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homedir: string;
  /** True when `path` is an existing regular file the current user may execute. */
  isExecutable(path: string): boolean;
  /** Best-effort version lookup; `undefined` when it is not cheaply available. */
  readVersion?(executablePath: string, platform: HostPlatform): Promise<string | undefined>;
}

/** Reads an env var, case-insensitively on Windows where `Path` and `PATH` are the same variable. */
export function readEnv(host: Pick<BrowserHost, "env" | "platform">, name: string): string | undefined {
  const direct = host.env[name];
  if (direct !== undefined || host.platform !== "win32") return direct === "" ? undefined : direct;
  const upper = name.toUpperCase();
  for (const [key, value] of Object.entries(host.env)) {
    if (key.toUpperCase() === upper && value !== undefined && value !== "") return value;
  }
  return undefined;
}

export function toHostPlatform(platform: string): HostPlatform {
  if (platform === "win32" || platform === "darwin") return platform;
  // Everything else (linux, freebsd, ...) uses the XDG / FHS layout.
  return "linux";
}

const VERSION_RE = /(\d+\.\d+\.\d+\.\d+)/;

async function readVersionFromHost(
  executablePath: string,
  platform: HostPlatform,
): Promise<string | undefined> {
  try {
    if (platform === "win32") {
      // Chromium-based browsers on Windows keep a `<version>` directory next to the executable.
      const dir = dirname(executablePath);
      const versions = readdirSync(dir).filter((entry) => /^\d+\.\d+\.\d+\.\d+$/.test(entry));
      versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      return versions[0];
    }
    if (platform === "darwin") {
      // <App>.app/Contents/MacOS/<exe> -> <App>.app/Contents/Info.plist
      const plist = readFileSync(join(dirname(dirname(executablePath)), "Info.plist"), "utf8");
      const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
      return match?.[1];
    }
  } catch {
    return undefined;
  }
  return new Promise((resolve) => {
    execFile(executablePath, ["--version"], { timeout: 3000 }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      resolve(VERSION_RE.exec(stdout)?.[1]);
    });
  });
}

/** The real host: `process.platform`, `process.env`, the user's home directory and `node:fs`. */
export function nodeBrowserHost(): BrowserHost {
  return {
    platform: toHostPlatform(process.platform),
    env: process.env,
    homedir: homedir(),
    isExecutable(path: string): boolean {
      try {
        if (!statSync(path).isFile()) return false;
        if (process.platform !== "win32") accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    readVersion: readVersionFromHost,
  };
}
