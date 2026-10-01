// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Launches the web Computer (installed browser + named profile) for a run.
import { launchWebComputer } from "@ghosthand/driver-playwright";
import type { ComputerLauncher } from "./run-agent.ts";
import type { EngineRuntime } from "./runtime.ts";
import type { BrowserCookie } from "./testbed.ts";

export interface WebLaunchOptions {
  startUrl: string;
  allowOrigins?: string[];
  profile?: string;
  headless?: boolean;
  cookies?: BrowserCookie[];
}

export function webLauncher(rt: EngineRuntime, opts: WebLaunchOptions): ComputerLauncher {
  return async () => {
    const b = rt.config.browser;
    const launched = await launchWebComputer({
      profile: opts.profile ?? b.profile,
      channel: b.channel,
      headless: opts.headless ?? b.headless,
      viewport: b.viewport,
      secrets: rt.secrets,
      startUrl: opts.startUrl,
      allowOrigins: opts.allowOrigins ?? [],
      blockOrigins: rt.config.blockedOrigins,
      logger: rt.logger.child({ pkg: "driver-playwright" }),
    });
    if (!launched.ok)
      return { ok: false, error: { message: `${launched.error.kind}: ${launched.error.message}` } };
    const { computer, browserInfo } = launched.value;
    if (opts.cookies && opts.cookies.length > 0) await computer.page.context().addCookies(opts.cookies);
    return {
      ok: true,
      value: {
        computer,
        surface: `${browserInfo.kind} ${browserInfo.version} / profile ${browserInfo.profile}`,
        close: () => computer.close(),
      },
    };
  };
}
