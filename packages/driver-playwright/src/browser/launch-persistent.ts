// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Launches the chosen browser with a named GhostHand profile as a Playwright persistent context.

import { existsSync } from "node:fs";
import type { ComputerError, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { BrowserContext } from "playwright-core";
import { chromium } from "playwright-core";
import type { BrowserChannelPreference, BrowserChoice } from "./choose-browser.ts";
import { chooseBrowser } from "./choose-browser.ts";
import { detectBrowsers } from "./detect-browsers.ts";
import type { BrowserHost } from "./host.ts";
import { nodeBrowserHost } from "./host.ts";
import { toComputerError } from "./profile-error.ts";
import { findLiveLock } from "./profile-lock.ts";
import type { PasswordStore } from "./profile-metadata.ts";
import type { ProfileStore } from "./profile-store.ts";
import { openProfileStore } from "./profile-store.ts";

export interface LaunchPersistentOptions {
  /** GhostHand profile name; created when missing. */
  readonly profile: string;
  /** Defaults to `auto` (chrome > msedge > brave > Playwright Chromium). Ignored when `executablePath` is set. */
  readonly channel?: BrowserChannelPreference;
  /** Launch this executable instead of a detected browser. */
  readonly executablePath?: string;
  readonly headless?: boolean;
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly args?: readonly string[];
  /** Overrides the profile's recorded password store. */
  readonly passwordStore?: PasswordStore;
  readonly timeoutMs?: number;
  readonly store?: ProfileStore;
  readonly host?: BrowserHost;
}

export interface BrowserInfo {
  readonly kind: BrowserChoice["kind"] | "custom";
  readonly executablePath: string;
  readonly channel?: string;
  /** Version reported by the running browser. */
  readonly version: string;
  readonly bundled: boolean;
  readonly profile: string;
  readonly userDataDir: string;
}

export interface LaunchedBrowser {
  readonly context: BrowserContext;
  readonly browserInfo: BrowserInfo;
}

/** Playwright's downloaded Chromium, when it exists on disk. */
export function bundledChromiumPath(): string | undefined {
  try {
    const path = chromium.executablePath();
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** Maps a Playwright launch exception to a `ComputerError`. */
export function mapLaunchError(error: unknown, choice: { executablePath: string }): ComputerError {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|ENOENT|spawn .* EACCES/.test(message)) {
    return {
      kind: "browser_not_found",
      message: `Browser executable not usable at ${choice.executablePath}: ${message}`,
    };
  }
  if (/ProcessSingleton|profile appears to be in use|exitCode=21/.test(message)) {
    return { kind: "profile_locked", message: `The profile is in use by another browser: ${message}` };
  }
  return { kind: "launch_failed", message };
}

async function pickBrowser(options: LaunchPersistentOptions, host: BrowserHost) {
  if (options.executablePath !== undefined) {
    if (!host.isExecutable(options.executablePath)) {
      return err<ComputerError>({
        kind: "browser_not_found",
        message: `No executable browser at ${options.executablePath}`,
      });
    }
    return ok<BrowserChoice & { custom: true }>({
      kind: "chromium",
      executablePath: options.executablePath,
      bundled: false,
      custom: true,
    });
  }
  const installed = await detectBrowsers(host);
  const preference = options.channel ?? "auto";
  const needsBundled = preference === "chromium" || (preference === "auto" && installed.length === 0);
  return chooseBrowser(installed, preference, needsBundled ? bundledChromiumPath() : undefined);
}

/**
 * Opens `profile` in the chosen browser via `chromium.launchPersistentContext`.
 * Errors: `browser_not_found`, `profile_locked` (another browser holds the profile), `launch_failed`.
 */
export async function launchPersistent(
  options: LaunchPersistentOptions,
): Promise<Result<LaunchedBrowser, ComputerError>> {
  const host = options.host ?? nodeBrowserHost();
  const store = options.store ?? openProfileStore({ host });
  const choice = await pickBrowser(options, host);
  if (!choice.ok) return choice;

  const profile = await store.ensure(options.profile);
  if (!profile.ok) return err(toComputerError(profile.error));
  const userDataDir = profile.value.dir;
  const lock = findLiveLock(userDataDir, store.lockProbe);
  if (lock !== undefined) {
    return err({
      kind: "profile_locked",
      message: `Profile "${options.profile}" is in use (${lock.reason}).`,
    });
  }

  const passwordStore = options.passwordStore ?? profile.value.metadata?.passwordStore ?? "basic";
  const browser = choice.value;
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: browser.executablePath,
      ...(browser.channel !== undefined ? { channel: browser.channel } : {}),
      headless: options.headless ?? false,
      viewport: options.viewport ? { width: options.viewport.width, height: options.viewport.height } : null,
      args: [...(options.args ?? [])],
      // Playwright forces a fake keyring by default; imported profiles need the real one to read cookies.
      ...(passwordStore === "os"
        ? { ignoreDefaultArgs: ["--password-store=basic", "--use-mock-keychain"] }
        : {}),
      ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    });
  } catch (error) {
    return err(mapLaunchError(error, browser));
  }

  // Best effort: a failed timestamp update must not fail the launch.
  await store.markUsed(profile.value);
  const version = context.browser()?.version() ?? browser.version ?? "unknown";
  const custom = "custom" in browser;
  return ok({
    context,
    browserInfo: {
      kind: custom ? "custom" : browser.kind,
      executablePath: browser.executablePath,
      ...(browser.channel !== undefined ? { channel: browser.channel } : {}),
      version,
      bundled: browser.bundled,
      profile: profile.value.name,
      userDataDir,
    },
  });
}
