// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// GNOME Wayland. The sandbox is a headless `mutter --virtual-monitor` in a private D-Bus session with a private
// XDG_RUNTIME_DIR and PipeWire: nothing reaches the user's session bus, compositor or PipeWire graph. Input uses
// Mutter's RemoteDesktop D-Bus API on that private bus (no consent prompt), capture a Mutter ScreenCast stream.
// Driving the user's own GNOME session (portal RemoteDesktop + restore token) is opt-in and not built yet.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger, SecretsRegistry } from "@ghosthand/core";
import type { ComputerError, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { DesktopApp } from "../desktop-computer.ts";
import type { ConnectedHost } from "./connect-host.ts";
import { connectHost } from "./connect-host.ts";
import type { SystemProbe } from "./system.ts";
import { nodeSystem, packageRoot, rpcFdWrapper } from "./system.ts";

export interface WaylandSandboxOptions {
  width?: number;
  height?: number;
  app?: DesktopApp;
  appFor?: (ctx: { sandboxWorkDir: string }) => DesktopApp;
  workDir?: string;
  /** Drive the user's own GNOME session through the portal. Opt-in; not available in this build. */
  hostSession?: boolean;
  secrets?: SecretsRegistry;
  logger?: Logger;
  startupTimeoutMs?: number;
  system?: SystemProbe;
}

export interface WaylandSandbox extends ConnectedHost {
  workDir: string;
}

export async function launchWaylandSandbox(
  opts: WaylandSandboxOptions = {},
): Promise<Result<WaylandSandbox, ComputerError>> {
  const system = opts.system ?? nodeSystem;
  if (opts.hostSession)
    return err({
      kind: "launch_failed",
      message:
        "driving the host GNOME session (portal RemoteDesktop + restore token) is not built yet; use the headless sandbox",
    });
  if (system.platform !== "linux")
    return err({ kind: "launch_failed", message: "GNOME Wayland runs on Linux only" });
  for (const bin of ["mutter", "python3", "dbus-run-session"]) {
    if (!system.which(bin)) return err({ kind: "launch_failed", message: `${bin} is not installed` });
  }
  const ownWork = opts.workDir === undefined;
  const workDir = opts.workDir ?? mkdtempSync(join(tmpdir(), "ghosthand-wayland-"));
  // Private runtime dir: our compositor socket, PipeWire and any activated service live here, not in /run/user.
  const runtimeDir = mkdtempSync(join(tmpdir(), "ghosthand-wl-rt-"));
  const width = opts.width ?? 1280;
  const height = opts.height ?? 800;
  const { DISPLAY: _d, WAYLAND_DISPLAY: _w, DBUS_SESSION_BUS_ADDRESS: _b, ...base } = system.env;
  const env: NodeJS.ProcessEnv = {
    ...base,
    XDG_RUNTIME_DIR: runtimeDir,
    GHOSTHAND_PRIVATE_RUNTIME: "1",
    GVFS_DISABLE_FUSE: "1",
    GIO_USE_VFS: "local",
    GDK_BACKEND: "wayland",
    XDG_SESSION_TYPE: "wayland",
    PYTHONPATH: join(packageRoot(), "hosts/linux"),
    PYTHONDONTWRITEBYTECODE: "1",
  };
  const spawn = rpcFdWrapper([
    "dbus-run-session",
    "--",
    "python3",
    "-m",
    "ghosthand_desktop_host",
    "--backend",
    "mutter",
    "--sandbox",
    "--size",
    `${width}x${height}`,
  ]);
  const app = opts.app ?? opts.appFor?.({ sandboxWorkDir: workDir });
  const connected = await connectHost({
    spawn: { ...spawn, env, startupTimeoutMs: opts.startupTimeoutMs ?? 60_000 },
    surface: "wayland",
    ...(app ? { app } : {}),
    ...(opts.secrets ? { secrets: opts.secrets } : {}),
    shared: { hostPath: workDir, localPath: workDir },
    ...(opts.logger ? { logger: opts.logger } : {}),
    onClose: async () => {
      rmSync(runtimeDir, { recursive: true, force: true });
      if (ownWork) rmSync(workDir, { recursive: true, force: true });
    },
  });
  if (!connected.ok) return connected;
  return ok({ ...connected.value, workDir });
}
