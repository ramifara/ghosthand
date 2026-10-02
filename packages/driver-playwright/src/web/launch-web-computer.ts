// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Real launches: the installed browser with a named GhostHand profile (P0-07), wrapped in a WebComputer.
import { randomUUID } from "node:crypto";
import { SecretsRegistry } from "@ghosthand/core";
import type { BrowserNetworkInput, ComputerError, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { BrowserInfo, LaunchPersistentOptions } from "../browser/launch-persistent.ts";
import { launchPersistent } from "../browser/launch-persistent.ts";
import { prepareBrowserNetwork } from "../browser/prepare-browser-network.ts";
import { registerGhosthandEngine } from "./engine-client.ts";
import type { WebComputer, WebComputerOptions } from "./web-computer.ts";
import { createWebComputer } from "./web-computer.ts";

export type LaunchWebComputerOptions = LaunchPersistentOptions &
  Omit<WebComputerOptions, "context" | "page"> & { network?: BrowserNetworkInput };

export interface LaunchedWebComputer {
  computer: WebComputer;
  browserInfo: BrowserInfo;
}

/**
 * Launches the browser with `profile` and returns a WebComputer that owns the context (`close()` closes
 * the browser). Video is not recorded here; pass a context created with `recordVideo` to
 * `createWebComputer` when you need it.
 */
export async function launchWebComputer(
  opts: LaunchWebComputerOptions,
): Promise<Result<LaunchedWebComputer, ComputerError>> {
  // The selector engine must exist before the first document is created.
  const registered = await registerGhosthandEngine();
  if (!registered.ok) return registered;
  const secrets = opts.secrets ?? new SecretsRegistry();
  const prepared = await prepareBrowserNetwork({ ...opts, secrets });
  if (!prepared.ok) return prepared;
  const launched = await launchPersistent({ ...opts, ...prepared.value });
  if (!launched.ok) return launched;
  const { context, browserInfo } = launched.value;
  try {
    if (prepared.value.cookies.length > 0) {
      const existing = await context.cookies();
      const cookies = prepared.value.cookies.filter(
        (cookie) =>
          cookie.name === "cf_clearance" ||
          !existing.some(
            (stored) =>
              stored.name === cookie.name &&
              stored.domain.replace(/^\./, "") === cookie.domain.replace(/^\./, "") &&
              stored.path === cookie.path,
          ),
      );
      const prefix = `flaresolverr.cookie.${randomUUID()}`;
      cookies.forEach((cookie, i) => {
        secrets.register(`${prefix}.${i}`, cookie.value);
      });
      await context.addCookies(cookies);
    }
  } catch {
    await context.close().catch(() => {});
    return err({
      kind: "launch_failed",
      message: "FlareSolverr cookies could not be imported into the browser",
    });
  }
  const created = await createWebComputer({
    ...opts,
    secrets,
    context,
    closeContext: opts.closeContext ?? true,
  });
  if (!created.ok) {
    await context.close().catch(() => {});
    return err(created.error);
  }
  return ok({ computer: created.value, browserInfo });
}
