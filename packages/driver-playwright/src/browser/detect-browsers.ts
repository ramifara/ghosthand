// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Finds installed Chrome, Edge and Brave from known install paths (and `PATH` on Linux).

import { posix, win32 } from "node:path";
import type { BrowserHost, HostPlatform } from "./host.ts";
import { readEnv } from "./host.ts";

export type InstalledBrowserKind = "chrome" | "msedge" | "brave";
/** Playwright channels we use. Brave has none and launches by `executablePath`. */
export type PlaywrightChannel = "chrome" | "msedge";

export interface InstalledBrowser {
  readonly kind: InstalledBrowserKind;
  readonly executablePath: string;
  /** Set for Chrome and Edge. */
  readonly channel?: PlaywrightChannel;
  readonly version?: string;
}

export interface BrowserCandidates {
  readonly paths: readonly string[];
  /** Command names looked up on `PATH` (Linux only). */
  readonly commands: readonly string[];
}

/** Detection order, which is also the `auto` preference order. */
export const INSTALLED_BROWSER_KINDS: readonly InstalledBrowserKind[] = ["chrome", "msedge", "brave"];

const CHANNEL_BY_KIND: Record<InstalledBrowserKind, PlaywrightChannel | undefined> = {
  chrome: "chrome",
  msedge: "msedge",
  brave: undefined,
};

function linuxCandidates(kind: InstalledBrowserKind): BrowserCandidates {
  switch (kind) {
    case "chrome":
      return {
        paths: ["/opt/google/chrome/chrome", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"],
        commands: ["google-chrome-stable", "google-chrome"],
      };
    case "msedge":
      return {
        paths: ["/opt/microsoft/msedge/msedge", "/usr/bin/microsoft-edge-stable", "/usr/bin/microsoft-edge"],
        commands: ["microsoft-edge-stable", "microsoft-edge"],
      };
    case "brave":
      return {
        paths: [
          "/opt/brave.com/brave/brave",
          "/usr/bin/brave-browser-stable",
          "/usr/bin/brave-browser",
          "/usr/bin/brave",
          "/snap/bin/brave",
        ],
        commands: ["brave-browser-stable", "brave-browser", "brave"],
      };
  }
}

const MAC_APPS: Record<InstalledBrowserKind, string> = {
  chrome: "Google Chrome",
  msedge: "Microsoft Edge",
  brave: "Brave Browser",
};

function macCandidates(kind: InstalledBrowserKind, home: string): BrowserCandidates {
  const app = MAC_APPS[kind];
  const rel = `${app}.app/Contents/MacOS/${app}`;
  return { paths: [posix.join("/Applications", rel), posix.join(home, "Applications", rel)], commands: [] };
}

const WIN_RELATIVE: Record<InstalledBrowserKind, string> = {
  chrome: "Google\\Chrome\\Application\\chrome.exe",
  msedge: "Microsoft\\Edge\\Application\\msedge.exe",
  brave: "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
};

function windowsCandidates(kind: InstalledBrowserKind, host: Pick<BrowserHost, "env" | "platform">) {
  const roots = [
    readEnv(host, "PROGRAMFILES") ?? "C:\\Program Files",
    readEnv(host, "PROGRAMFILES(X86)") ?? "C:\\Program Files (x86)",
    readEnv(host, "LOCALAPPDATA"),
  ].filter((root): root is string => root !== undefined);
  const unique = [...new Set(roots)];
  return { paths: unique.map((root) => win32.join(root, WIN_RELATIVE[kind])), commands: [] };
}

/** Known install locations for one browser kind on one platform, in lookup order. */
export function browserCandidates(
  kind: InstalledBrowserKind,
  host: Pick<BrowserHost, "env" | "platform" | "homedir">,
): BrowserCandidates {
  const platform: HostPlatform = host.platform;
  if (platform === "win32") return windowsCandidates(kind, host);
  if (platform === "darwin") return macCandidates(kind, host.homedir);
  return linuxCandidates(kind);
}

/** `which` over the host's `PATH` using the injected executable check. */
export function whichOnHost(command: string, host: Pick<BrowserHost, "env" | "platform" | "isExecutable">) {
  const pathVar = readEnv(host, "PATH");
  if (pathVar === undefined) return undefined;
  const delimiter = host.platform === "win32" ? win32.delimiter : posix.delimiter;
  const join = host.platform === "win32" ? win32.join : posix.join;
  for (const dir of pathVar.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, command);
    if (host.isExecutable(candidate)) return candidate;
  }
  return undefined;
}

/** First executable for `kind`, or `undefined` when it is not installed. */
export function findBrowserExecutable(kind: InstalledBrowserKind, host: BrowserHost): string | undefined {
  const { paths, commands } = browserCandidates(kind, host);
  const known = paths.find((path) => host.isExecutable(path));
  if (known !== undefined) return known;
  for (const command of commands) {
    const found = whichOnHost(command, host);
    if (found !== undefined) return found;
  }
  return undefined;
}

export interface DetectOptions {
  /** Also look up versions (runs `--version` on Linux; reads metadata on macOS and Windows). */
  readonly withVersion?: boolean;
}

/** Installed Chrome, Edge and Brave, one entry per kind, in `auto` preference order. */
export async function detectBrowsers(
  host: BrowserHost,
  options: DetectOptions = {},
): Promise<readonly InstalledBrowser[]> {
  const found: InstalledBrowser[] = [];
  for (const kind of INSTALLED_BROWSER_KINDS) {
    const executablePath = findBrowserExecutable(kind, host);
    if (executablePath === undefined) continue;
    const channel = CHANNEL_BY_KIND[kind];
    const version =
      options.withVersion === true && host.readVersion !== undefined
        ? await host.readVersion(executablePath, host.platform)
        : undefined;
    found.push({
      kind,
      executablePath,
      ...(channel !== undefined ? { channel } : {}),
      ...(version !== undefined ? { version } : {}),
    });
  }
  return found;
}
