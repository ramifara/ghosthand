// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Picks the browser to launch from the detected list and `browser.channel` in the config.

import type { ComputerError, GhostHandConfig, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { InstalledBrowser, PlaywrightChannel } from "./detect-browsers.ts";
import { INSTALLED_BROWSER_KINDS } from "./detect-browsers.ts";

export type BrowserChannelPreference = GhostHandConfig["browser"]["channel"];

/** What to launch: an installed browser, or Playwright's downloaded Chromium. */
export interface BrowserChoice {
  readonly kind: InstalledBrowser["kind"] | "chromium";
  readonly executablePath: string;
  readonly channel?: PlaywrightChannel;
  readonly version?: string;
  /** True when this is Playwright's downloaded Chromium rather than an installed browser. */
  readonly bundled: boolean;
}

const INSTALL_HINT = "Install Chrome, Edge or Brave, or run `npx playwright-core install chromium`.";

function fromInstalled(browser: InstalledBrowser): BrowserChoice {
  return { ...browser, bundled: false };
}

function bundledChoice(bundledChromiumPath: string | undefined): Result<BrowserChoice, ComputerError> {
  if (bundledChromiumPath === undefined) {
    return err({
      kind: "browser_not_found",
      message: `No installed Chrome, Edge or Brave was found and Playwright's Chromium is not downloaded. ${INSTALL_HINT}`,
    });
  }
  return ok({ kind: "chromium", executablePath: bundledChromiumPath, bundled: true });
}

/**
 * `auto` prefers chrome > msedge > brave > Playwright's Chromium. A named channel must be installed.
 * `bundledChromiumPath` is the downloaded Chromium executable when it exists on disk.
 */
export function chooseBrowser(
  installed: readonly InstalledBrowser[],
  preference: BrowserChannelPreference,
  bundledChromiumPath: string | undefined,
): Result<BrowserChoice, ComputerError> {
  if (preference === "chromium") return bundledChoice(bundledChromiumPath);
  if (preference === "auto") {
    for (const kind of INSTALLED_BROWSER_KINDS) {
      const match = installed.find((browser) => browser.kind === kind);
      if (match !== undefined) return ok(fromInstalled(match));
    }
    return bundledChoice(bundledChromiumPath);
  }
  const match = installed.find((browser) => browser.kind === preference);
  if (match !== undefined) return ok(fromInstalled(match));
  return err({
    kind: "browser_not_found",
    message: `browser.channel is "${preference}" but it is not installed. Set browser.channel to "auto" or install it.`,
  });
}
