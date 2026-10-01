// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Real launches: the installed browser with a named GhostHand profile (P0-07), wrapped in a WebComputer.
import type { ComputerError, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { BrowserInfo, LaunchPersistentOptions } from "../browser/launch-persistent.ts";
import { launchPersistent } from "../browser/launch-persistent.ts";
import { registerGhosthandEngine } from "./engine-client.ts";
import type { WebComputer, WebComputerOptions } from "./web-computer.ts";
import { createWebComputer } from "./web-computer.ts";

export type LaunchWebComputerOptions = LaunchPersistentOptions & Omit<WebComputerOptions, "context" | "page">;

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
  const launched = await launchPersistent(opts);
  if (!launched.ok) return launched;
  const { context, browserInfo } = launched.value;
  const created = await createWebComputer({ ...opts, context, closeContext: opts.closeContext ?? true });
  if (!created.ok) {
    await context.close().catch(() => {});
    return err(created.error);
  }
  return ok({ computer: created.value, browserInfo });
}
