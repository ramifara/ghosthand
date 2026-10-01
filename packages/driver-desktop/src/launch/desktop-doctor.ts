// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand doctor` checks for the desktop drivers, per OS. Read-only: nothing is started on the user's
// session. Optional pieces report ok with what they enable; a check fails only when no desktop surface works.
import { existsSync } from "node:fs";
import type { DoctorCheck } from "@ghosthand/protocol";
import { nativeHostCandidates } from "./native-host.ts";
import type { SystemProbe } from "./system.ts";
import { nodeSystem } from "./system.ts";

const PY_ATSPI =
  "import gi; gi.require_version('Atspi', '2.0'); from gi.repository import Atspi; print('ok')";

async function runtimeCheck(system: SystemProbe, rt: "docker" | "podman"): Promise<string | undefined> {
  if (!system.which(rt)) return undefined;
  const r = await system.run(rt, ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 8000 });
  return r.code === 0
    ? `${rt} ${r.stdout.trim()}`
    : `${rt} installed but not usable (${r.stderr.trim().slice(0, 80)})`;
}

const present = (system: SystemProbe, bin: string): boolean => system.which(bin) !== undefined;

async function linuxChecks(system: SystemProbe): Promise<DoctorCheck[]> {
  const env = system.env;
  const checks: DoctorCheck[] = [];
  const session = env.XDG_SESSION_TYPE ?? (env.WAYLAND_DISPLAY ? "wayland" : env.DISPLAY ? "x11" : "none");
  checks.push({
    name: "display server",
    ok: true,
    detail: `${session}${env.XDG_CURRENT_DESKTOP ? ` (${env.XDG_CURRENT_DESKTOP})` : ""}; sandboxes never use it`,
  });
  const docker = await runtimeCheck(system, "docker");
  const podman = await runtimeCheck(system, "podman");
  const usable = [docker, podman].filter((d) => d !== undefined && !d.includes("not usable"));
  checks.push({
    name: "container runtime",
    ok: true,
    detail:
      [docker, podman].filter(Boolean).join("; ") ||
      "none (optional: install docker or podman for the X11 container)",
  });
  const xvfb = present(system, "Xvfb");
  checks.push({
    name: "xvfb",
    ok: true,
    detail: xvfb
      ? "installed (host X11 sandbox)"
      : "missing (optional: host X11 sandbox without a container)",
  });
  checks.push({
    name: "xdotool",
    ok: true,
    detail: present(system, "xdotool")
      ? "installed"
      : "missing on the host (the container image has it; needed only for the host X11 sandbox)",
  });
  checks.push({
    name: "ffmpeg",
    ok: true,
    detail: present(system, "ffmpeg") ? "installed (recording)" : "missing (optional: recording)",
  });
  const py = present(system, "python3")
    ? await system.run("python3", ["-c", PY_ATSPI], { timeoutMs: 8000 })
    : { code: 1, stdout: "", stderr: "python3 missing" };
  const atspi = py.code === 0;
  checks.push({
    name: "at-spi (python gi)",
    ok: true,
    detail: atspi
      ? "libatspi via python3-gobject"
      : "missing (needed for host sandboxes; the container has it)",
  });
  const a11yBus = present(system, "busctl")
    ? await system.run("busctl", ["--user", "status", "org.a11y.Bus"], { timeoutMs: 5000 })
    : { code: 1, stdout: "", stderr: "" };
  checks.push({
    name: "at-spi bus",
    ok: true,
    detail:
      a11yBus.code === 0
        ? "org.a11y.Bus on your session"
        : "not on your session bus (sandboxes start their own)",
  });
  const mutter = present(system, "mutter");
  const pipewire = present(system, "pipewire") && present(system, "gst-launch-1.0");
  checks.push({
    name: "wayland sandbox",
    ok: true,
    detail: mutter
      ? `mutter --headless available${pipewire ? ", PipeWire capture" : ", no PipeWire/GStreamer (no screenshots)"}${atspi ? "" : ", needs python3-gobject"}`
      : "mutter missing (optional: headless GNOME sandbox)",
  });
  const x11 = usable.length > 0 || (xvfb && atspi && present(system, "dbus-run-session"));
  checks.push({
    name: "x11 sandbox",
    ok: x11 || (mutter && atspi),
    detail: x11
      ? usable.length > 0
        ? `ready (${usable[0]?.split(" ")[0]} container)`
        : "ready (host Xvfb)"
      : "no container runtime and no Xvfb: install docker or podman (see docs/desktop-drivers.md)",
  });
  return checks;
}

async function windowsChecks(system: SystemProbe): Promise<DoctorCheck[]> {
  const host = nativeHostCandidates("windows", system.env).find((p) => existsSync(p));
  return [
    {
      name: "uia host",
      ok: true,
      detail: host ?? "not built (dotnet publish hosts/windows/GhostHand.UiaHost; optional)",
    },
    {
      name: "dotnet",
      ok: true,
      detail: present(system, "dotnet") ? "installed" : "missing (needed to build the UIA host)",
    },
  ];
}

async function macosChecks(system: SystemProbe): Promise<DoctorCheck[]> {
  const host = nativeHostCandidates("macos", system.env).find((p) => existsSync(p));
  return [
    {
      name: "ax host",
      ok: true,
      detail: host
        ? `${host} (grant Accessibility and Screen Recording to your terminal)`
        : "not built (swift build -c release in hosts/macos; optional)",
    },
    {
      name: "swift",
      ok: true,
      detail: present(system, "swift") ? "installed" : "missing (needed to build the AX host)",
    },
  ];
}

export async function desktopDoctorChecks(system: SystemProbe = nodeSystem): Promise<DoctorCheck[]> {
  const checks =
    system.platform === "linux"
      ? await linuxChecks(system)
      : system.platform === "win32"
        ? await windowsChecks(system)
        : system.platform === "darwin"
          ? await macosChecks(system)
          : [];
  return checks.map((c) => ({ ...c, name: `desktop ${c.name}` }));
}
