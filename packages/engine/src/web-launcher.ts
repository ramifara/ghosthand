// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Launches the web Computer (installed browser + named profile) for a run.
import { launchWebComputer, type WebComputer } from "@ghosthand/driver-playwright";
import { CONTROL_ORIGIN } from "@ghosthand/testbed-kit";
import type { ComputerLauncher } from "./run-agent.ts";
import type { EngineRuntime } from "./runtime.ts";
import type { BrowserCookie } from "./testbed.ts";

export interface WebLaunchOptions {
  startUrl: string;
  allowOrigins?: string[];
  profile?: string;
  headless?: boolean;
  cookies?: BrowserCookie[];
  /** Files `set_value` may upload into file inputs (by base name). */
  uploadDir?: string;
}

/** Launches the browser and returns the WebComputer itself (QA mode needs its page and error log). */
export async function launchWeb(
  rt: EngineRuntime,
  opts: WebLaunchOptions,
): Promise<
  { ok: true; value: { computer: WebComputer; surface: string } } | { ok: false; error: { message: string } }
> {
  const b = rt.config.browser;
  const launched = await launchWebComputer({
    profile: opts.profile ?? b.profile,
    channel: b.channel,
    headless: opts.headless ?? b.headless,
    viewport: b.viewport,
    secrets: rt.secrets,
    startUrl: opts.startUrl,
    allowOrigins: opts.allowOrigins ?? [],
    // The testbed control API is always blocked (the driver blocks :4401; this covers a port offset).
    blockOrigins: [...rt.config.blockedOrigins, CONTROL_ORIGIN],
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
    },
  };
}

export function webLauncher(rt: EngineRuntime, opts: WebLaunchOptions): ComputerLauncher {
  return async () => {
    const launched = await launchWeb(rt, opts);
    if (!launched.ok) return launched;
    const { computer, surface } = launched.value;
    return { ok: true, value: { computer, surface, close: () => computer.close() } };
  };
}
