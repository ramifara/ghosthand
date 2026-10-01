// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// One entry point for every desktop surface.
import type { Logger, SecretsRegistry } from "@ghosthand/core";
import type { ComputerError, HelloResult, Result } from "@ghosthand/protocol";
import { ok } from "@ghosthand/protocol";
import type { DesktopApp, DesktopComputer } from "../desktop-computer.ts";
import { launchNativeHost } from "./native-host.ts";
import type { SystemProbe } from "./system.ts";
import { launchWaylandSandbox } from "./wayland-sandbox.ts";
import type { SandboxRuntime } from "./x11-sandbox.ts";
import { launchX11Sandbox } from "./x11-sandbox.ts";

export type DesktopSurface = "x11" | "wayland" | "windows" | "macos";
export const DESKTOP_SURFACES: readonly DesktopSurface[] = ["x11", "wayland", "windows", "macos"];

export interface LaunchDesktopOptions {
  surface: DesktopSurface;
  app?: DesktopApp;
  /** App whose argv depends on where the sandbox runs (container paths vs host paths). */
  appFor?: (ctx: { runtime: SandboxRuntime | "native"; sandboxWorkDir: string }) => DesktopApp;
  /** X11: container runtime or host Xvfb. */
  runtime?: "auto" | SandboxRuntime;
  vncPort?: number;
  network?: boolean;
  workDir?: string;
  width?: number;
  height?: number;
  /** Windows/macOS: opt in to driving the real desktop. */
  allowHostDesktop?: boolean;
  hostBinary?: string;
  secrets?: SecretsRegistry;
  logger?: Logger;
  system?: SystemProbe;
}

export interface LaunchedDesktop {
  computer: DesktopComputer;
  hello: HelloResult;
  /** Local folder shared with the sandbox (state files, recordings); absent for native hosts. */
  workDir?: string;
  /** Short description for run.start. */
  describe: string;
}

export async function launchDesktop(
  opts: LaunchDesktopOptions,
): Promise<Result<LaunchedDesktop, ComputerError>> {
  const common = {
    ...(opts.secrets ? { secrets: opts.secrets } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(opts.system ? { system: opts.system } : {}),
  };
  const size = {
    ...(opts.width ? { width: opts.width } : {}),
    ...(opts.height ? { height: opts.height } : {}),
  };
  switch (opts.surface) {
    case "x11": {
      const appFor = opts.appFor;
      const r = await launchX11Sandbox({
        ...common,
        ...size,
        ...(opts.app ? { app: opts.app } : {}),
        ...(appFor ? { appFor: (ctx) => appFor(ctx) } : {}),
        ...(opts.runtime ? { runtime: opts.runtime } : {}),
        ...(opts.vncPort !== undefined ? { vncPort: opts.vncPort } : {}),
        ...(opts.network !== undefined ? { network: opts.network } : {}),
        ...(opts.workDir ? { workDir: opts.workDir } : {}),
      });
      if (!r.ok) return r;
      const s = r.value;
      return ok({
        computer: s.computer,
        hello: s.hello,
        workDir: s.workDir,
        describe: `x11 sandbox (${s.runtime}${s.image ? ` ${s.image}` : ""})${s.computer.vncUrl ? ` · live view ${s.computer.vncUrl}` : ""}`,
      });
    }
    case "wayland": {
      const appFor = opts.appFor;
      const r = await launchWaylandSandbox({
        ...common,
        ...size,
        ...(opts.app ? { app: opts.app } : {}),
        ...(appFor ? { appFor: (ctx) => appFor({ runtime: "host", ...ctx }) } : {}),
        ...(opts.workDir ? { workDir: opts.workDir } : {}),
      });
      if (!r.ok) return r;
      return ok({
        computer: r.value.computer,
        hello: r.value.hello,
        workDir: r.value.workDir,
        describe: "gnome wayland sandbox (mutter --headless)",
      });
    }
    case "windows":
    case "macos": {
      const app = opts.app ?? opts.appFor?.({ runtime: "native", sandboxWorkDir: "" });
      const r = await launchNativeHost({
        ...common,
        surface: opts.surface,
        ...(opts.allowHostDesktop ? { allowHostDesktop: true } : {}),
        ...(opts.hostBinary ? { binary: opts.hostBinary } : {}),
        ...(app ? { app } : {}),
      });
      if (!r.ok) return r;
      return ok({
        computer: r.value.computer,
        hello: r.value.hello,
        describe: `${opts.surface} host desktop (${r.value.hello.host.name} ${r.value.hello.host.version})`,
      });
    }
  }
}
