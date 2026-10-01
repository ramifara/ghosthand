// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The Linux X11 sandbox: Xvfb + window manager + AT-SPI + the Python RPC host, in a container (docker or
// podman) or, without one, directly on the host as an unprivileged user on a private display. The user's
// own display is never used.
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

export type SandboxRuntime = "docker" | "podman" | "host";

export interface X11SandboxOptions {
  /** "auto" picks docker, then podman, then host Xvfb. */
  runtime?: "auto" | SandboxRuntime;
  /** Image name without tag; the tag is a hash of the build inputs. Default "ghosthand-x11". */
  image?: string;
  /** Build the image when it is missing (default true). */
  build?: boolean;
  width?: number;
  height?: number;
  /** auto, xfwm4, mutter, openbox, twm or none. */
  wm?: string;
  /** Publish a noVNC live view on 127.0.0.1:<port> (container gets a bridged network then). */
  vncPort?: number;
  /** Give the container network access (default: none). */
  network?: boolean;
  /** Local folder shared with the sandbox as /work (state files, recordings). Default: a fresh temp folder. */
  workDir?: string;
  /** App to launch on the first open(). */
  app?: DesktopApp;
  /** App that depends on where the sandbox runs (e.g. `testbedApp`); used when `app` is not given. */
  appFor?: (ctx: { runtime: SandboxRuntime; sandboxWorkDir: string }) => DesktopApp;
  secrets?: SecretsRegistry;
  logger?: Logger;
  startupTimeoutMs?: number;
  system?: SystemProbe;
}

export interface X11Sandbox extends ConnectedHost {
  runtime: SandboxRuntime;
  /** Local folder shared with the sandbox. */
  workDir: string;
  /** The same folder as the sandbox sees it. */
  sandboxWorkDir: string;
  image?: string;
}

const LINUX_HOST_DIR = "hosts/linux";
const CONTAINER_WORK = "/work";
const CONTAINER_TESTBED = "/opt/ghosthand/testbed/desktop-testbed.py";

/** Files that make up the sandbox image; their hash is the image tag, so an image always matches the code. */
export function imageInputs(root = packageRoot()): string[] {
  const hostPkg = join(root, LINUX_HOST_DIR, "ghosthand_desktop_host");
  const files = [
    join(root, LINUX_HOST_DIR, "Containerfile"),
    join(root, LINUX_HOST_DIR, "sandbox-entry.sh"),
    join(root, "testbed", "desktop-testbed.py"),
    ...readdirSync(hostPkg)
      .filter((f) => f.endsWith(".py"))
      .sort()
      .map((f) => join(hostPkg, f)),
  ];
  return files;
}

/** The image's user: the host user's UID/GID (root maps to 1000; the work folder is opened up then). */
export function imageUser(): { uid: number; gid: number } {
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  return uid === 0 ? { uid: 1000, gid: 1000 } : { uid, gid };
}

export function imageTag(root = packageRoot(), user = imageUser()): string {
  const h = createHash("sha256");
  for (const f of imageInputs(root)) {
    h.update(f.slice(root.length));
    h.update(readFileSync(f));
  }
  h.update(`user ${user.uid}:${user.gid}`);
  return h.digest("hex").slice(0, 12);
}

export async function detectRuntime(system: SystemProbe = nodeSystem): Promise<SandboxRuntime | undefined> {
  for (const rt of ["docker", "podman"] as const) {
    if (!system.which(rt)) continue;
    const info = await system.run(rt, ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 8000 });
    if (info.code === 0) return rt;
  }
  if (system.which("Xvfb") && system.which("python3") && system.which("dbus-run-session")) return "host";
  return undefined;
}

/** Builds the sandbox image if no image with the current inputs' tag exists. */
export async function ensureImage(
  runtime: "docker" | "podman",
  opts: { image?: string; build?: boolean; logger?: Logger; system?: SystemProbe } = {},
): Promise<Result<string, ComputerError>> {
  const system = opts.system ?? nodeSystem;
  const root = packageRoot();
  const user = imageUser();
  const ref = `${opts.image ?? "ghosthand-x11"}:${imageTag(root, user)}`;
  const inspect = await system.run(runtime, ["image", "inspect", ref], { timeoutMs: 15_000 });
  if (inspect.code === 0) return ok(ref);
  if (opts.build === false)
    return err({
      kind: "launch_failed",
      message: `image ${ref} is missing; allow the first run to build it (about 220 MB of Debian packages)`,
    });
  opts.logger?.info({ image: ref }, "building the X11 sandbox image (first run takes a few minutes)");
  const mirror = system.env.GHOSTHAND_DEBIAN_MIRROR;
  const built = await system.run(
    runtime,
    [
      "build",
      "-t",
      ref,
      "-t",
      `${opts.image ?? "ghosthand-x11"}:latest`,
      ...(mirror ? ["--build-arg", `DEBIAN_MIRROR=${mirror}`] : []),
      "--build-arg",
      `GHOST_UID=${user.uid}`,
      "--build-arg",
      `GHOST_GID=${user.gid}`,
      "-f",
      join(root, LINUX_HOST_DIR, "Containerfile"),
      root,
    ],
    { timeoutMs: 60 * 60_000 },
  );
  if (built.code !== 0)
    return err({ kind: "launch_failed", message: `image build failed: ${built.stderr.slice(-600)}` });
  return ok(ref);
}

/** Argv for the desktop testbed app inside the given sandbox, writing its state to the shared folder. */
export function testbedApp(
  runtime: SandboxRuntime | "native",
  sandboxWorkDir: string,
  seed = "default",
): DesktopApp {
  const script =
    runtime === "docker" || runtime === "podman"
      ? CONTAINER_TESTBED
      : join(packageRoot(), "testbed", "desktop-testbed.py");
  return { argv: ["python3", script, "--state", `${sandboxWorkDir}/state.json`, "--seed", seed] };
}

/** Container arguments (exported for tests). */
export function containerArgs(o: {
  runtime: "docker" | "podman";
  image: string;
  name: string;
  workDir: string;
  width: number;
  height: number;
  wm: string;
  vncPort?: number;
  network: boolean;
}): string[] {
  const args = [
    "run",
    "--rm",
    "-i",
    "--init",
    "--name",
    o.name,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--shm-size",
    "256m",
    "-v",
    `${o.workDir}:${CONTAINER_WORK}:rw`,
  ];
  if (o.runtime === "podman") args.push("--userns", "keep-id");

  if (o.vncPort !== undefined) {
    // Publishing a port needs a network; bind it to loopback only.
    args.push("-p", `127.0.0.1:${o.vncPort}:${o.vncPort}`, "-e", "GHOSTHAND_VNC_LISTEN=0.0.0.0");
  } else if (!o.network) args.push("--network", "none");
  args.push(o.image, "--display", ":1", "--size", `${o.width}x${o.height}`, "--wm", o.wm);
  if (o.vncPort !== undefined) args.push("--vnc-port", String(o.vncPort));
  return args;
}

function freeDisplay(): string {
  for (let n = 90; n < 140; n++) {
    if (!existsSync(`/tmp/.X${n}-lock`) && !existsSync(`/tmp/.X11-unix/X${n}`)) return `:${n}`;
  }
  return `:${140 + Math.floor(Math.random() * 50)}`;
}

/** Starts the sandbox and connects to its host. `computer.open()` launches `opts.app`. */
export async function launchX11Sandbox(
  opts: X11SandboxOptions = {},
): Promise<Result<X11Sandbox, ComputerError>> {
  const system = opts.system ?? nodeSystem;
  if (system.platform !== "linux")
    return err({ kind: "launch_failed", message: "the X11 sandbox runs on Linux hosts only" });
  const wanted = opts.runtime ?? "auto";
  const runtime = wanted === "auto" ? await detectRuntime(system) : wanted;
  if (runtime === undefined)
    return err({
      kind: "launch_failed",
      message: "no container runtime (docker/podman) and no Xvfb found; see docs/desktop-drivers.md",
    });
  const ownWork = opts.workDir === undefined;
  const workDir = opts.workDir ?? mkdtempSync(join(tmpdir(), "ghosthand-x11-"));
  mkdirSync(workDir, { recursive: true });
  const width = opts.width ?? 1280;
  const height = opts.height ?? 800;
  const wm = opts.wm ?? "auto";
  const cleanupWork = async () => {
    if (ownWork) rmSync(workDir, { recursive: true, force: true });
  };

  const appFor = (sandboxWorkDir: string): DesktopApp | undefined =>
    opts.app ?? opts.appFor?.({ runtime, sandboxWorkDir });

  if (runtime === "host") {
    const app = appFor(workDir);
    const hostDir = join(packageRoot(), LINUX_HOST_DIR);
    const display = freeDisplay();
    const argv = [
      "dbus-run-session",
      "--",
      "python3",
      "-m",
      "ghosthand_desktop_host",
      "--backend",
      "x11",
      "--sandbox",
      "--display",
      display,
      "--size",
      `${width}x${height}`,
      "--wm",
      wm,
      ...(opts.vncPort !== undefined ? ["--vnc-port", String(opts.vncPort)] : []),
    ];
    // Private runtime dir: the private session's a11y bus and activated services keep out of /run/user.
    const runtimeDir = mkdtempSync(join(tmpdir(), "ghosthand-x11-rt-"));
    const { DBUS_SESSION_BUS_ADDRESS: _sessionBus, ...base } = system.env;
    const env: NodeJS.ProcessEnv = {
      ...base,
      XDG_RUNTIME_DIR: runtimeDir,
      GVFS_DISABLE_FUSE: "1",
      GIO_USE_VFS: "local",
      DISPLAY: display,
      PYTHONPATH: hostDir,
      PYTHONDONTWRITEBYTECODE: "1",
      // A private session bus (dbus-run-session) carries a private AT-SPI bus; never the user's.
      WAYLAND_DISPLAY: "",
      XDG_SESSION_TYPE: "x11",
    };
    const connected = await connectHost({
      spawn: {
        ...rpcFdWrapper(argv),
        env,
        startupTimeoutMs: opts.startupTimeoutMs ?? 60_000,
      },
      surface: "x11",
      ...(app ? { app } : {}),
      ...(opts.secrets ? { secrets: opts.secrets } : {}),
      shared: { hostPath: workDir, localPath: workDir },
      ...(opts.logger ? { logger: opts.logger } : {}),
      onClose: async () => {
        rmSync(runtimeDir, { recursive: true, force: true });
        await cleanupWork();
      },
    });
    if (!connected.ok) return connected;
    return ok({ ...connected.value, runtime, workDir, sandboxWorkDir: workDir });
  }

  const image = await ensureImage(runtime, {
    ...(opts.image ? { image: opts.image } : {}),
    ...(opts.build !== undefined ? { build: opts.build } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    system,
  });
  if (!image.ok) {
    await cleanupWork();
    return image;
  }
  const name = `ghosthand-x11-${randomBytes(4).toString("hex")}`;
  // Root on the host: the image user is 1000, so the private work folder must be writable for it.
  if (process.getuid?.() === 0) chmodSync(workDir, 0o777);
  const args = containerArgs({
    runtime,
    image: image.value,
    name,
    workDir,
    width,
    height,
    wm,
    ...(opts.vncPort !== undefined ? { vncPort: opts.vncPort } : {}),
    network: opts.network ?? false,
  });
  const app = appFor(CONTAINER_WORK);
  const connected = await connectHost({
    spawn: { command: runtime, args, startupTimeoutMs: opts.startupTimeoutMs ?? 90_000 },
    surface: "x11",
    ...(app ? { app } : {}),
    ...(opts.secrets ? { secrets: opts.secrets } : {}),
    shared: { hostPath: CONTAINER_WORK, localPath: workDir },
    ...(opts.logger ? { logger: opts.logger } : {}),
    onClose: async () => {
      // The container exits when the host's stdin closes; make sure, by name only.
      await system.run(runtime, ["rm", "-f", name], { timeoutMs: 15_000 });
      await cleanupWork();
    },
  });
  if (!connected.ok) return connected;
  return ok({ ...connected.value, runtime, workDir, sandboxWorkDir: CONTAINER_WORK, image: image.value });
}
