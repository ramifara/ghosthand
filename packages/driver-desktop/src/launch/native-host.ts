// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Windows (UIA) and macOS (AX) hosts drive the user's real desktop, so they are opt-in (`allowHostDesktop`).
// Build them first: hosts/windows (dotnet publish) and hosts/macos (swift build -c release).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Logger, SecretsRegistry } from "@ghosthand/core";
import type { ComputerError, Result } from "@ghosthand/protocol";
import { err } from "@ghosthand/protocol";
import type { DesktopApp } from "../desktop-computer.ts";
import type { ConnectedHost } from "./connect-host.ts";
import { connectHost } from "./connect-host.ts";
import type { SystemProbe } from "./system.ts";
import { nodeSystem, packageRoot } from "./system.ts";

export type NativeSurface = "windows" | "macos";

export interface NativeHostOptions {
  surface: NativeSurface;
  /** Required: these hosts act on the real desktop, not a sandbox. */
  allowHostDesktop?: boolean;
  /** Path to the host executable (default: env GHOSTHAND_UIA_HOST / GHOSTHAND_AX_HOST, then the build output). */
  binary?: string;
  app?: DesktopApp;
  secrets?: SecretsRegistry;
  logger?: Logger;
  system?: SystemProbe;
}

/** Candidate host executables, in order. */
export function nativeHostCandidates(
  surface: NativeSurface,
  env: NodeJS.ProcessEnv,
  root = packageRoot(),
): string[] {
  if (surface === "windows") {
    const proj = join(root, "hosts", "windows", "GhostHand.UiaHost");
    return [
      ...(env.GHOSTHAND_UIA_HOST ? [env.GHOSTHAND_UIA_HOST] : []),
      join(proj, "bin", "publish", "GhostHand.UiaHost.exe"),
      join(proj, "bin", "Release", "net8.0-windows", "GhostHand.UiaHost.exe"),
      join(proj, "bin", "Debug", "net8.0-windows", "GhostHand.UiaHost.exe"),
    ];
  }
  const pkg = join(root, "hosts", "macos");
  return [
    ...(env.GHOSTHAND_AX_HOST ? [env.GHOSTHAND_AX_HOST] : []),
    join(pkg, ".build", "release", "ghosthand-ax-host"),
    join(pkg, ".build", "debug", "ghosthand-ax-host"),
  ];
}

export async function launchNativeHost(
  opts: NativeHostOptions,
): Promise<Result<ConnectedHost, ComputerError>> {
  const system = opts.system ?? nodeSystem;
  const want = opts.surface === "windows" ? "win32" : "darwin";
  if (system.platform !== want)
    return err({ kind: "launch_failed", message: `the ${opts.surface} driver runs on ${opts.surface} only` });
  if (!opts.allowHostDesktop)
    return err({
      kind: "launch_failed",
      message: `the ${opts.surface} driver acts on your real desktop; pass --allow-host-desktop to opt in`,
    });
  const binary = opts.binary ?? nativeHostCandidates(opts.surface, system.env).find((p) => existsSync(p));
  if (binary === undefined)
    return err({
      kind: "launch_failed",
      message:
        opts.surface === "windows"
          ? "UIA host not built: dotnet publish packages/driver-desktop/hosts/windows/GhostHand.UiaHost -c Release -o packages/driver-desktop/hosts/windows/GhostHand.UiaHost/bin/publish"
          : "AX host not built: swift build -c release --package-path packages/driver-desktop/hosts/macos",
    });
  return connectHost({
    spawn: { command: binary, args: [], startupTimeoutMs: 30_000 },
    surface: opts.surface,
    ...(opts.app ? { app: opts.app } : {}),
    ...(opts.secrets ? { secrets: opts.secrets } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
}
