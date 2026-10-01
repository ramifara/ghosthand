// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Drives the headless GNOME (mutter --headless) sandbox with the GTK testbed. Runs in a private D-Bus session and
// a private runtime dir; never the user's session. Skipped without mutter, python3-gobject and dbus-run-session,
// or with GHOSTHAND_SKIP_SANDBOX_TESTS=1.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Element, Snapshot } from "@ghosthand/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nodeSystem } from "./system.ts";
import type { WaylandSandbox } from "./wayland-sandbox.ts";
import { launchWaylandSandbox } from "./wayland-sandbox.ts";
import { testbedApp } from "./x11-sandbox.ts";

const available =
  process.platform === "linux" &&
  process.env.GHOSTHAND_SKIP_SANDBOX_TESTS !== "1" &&
  ["mutter", "python3", "dbus-run-session"].every((b) => nodeSystem.which(b) !== undefined) &&
  (await nodeSystem.run("python3", ["-c", "import gi; gi.require_version('Atspi', '2.0')"])).code === 0;

const find = (s: Snapshot, role: string, name: string): Element => {
  const el = s.elements.find((e) => e.role === role && e.name === name);
  if (!el) throw new Error(`no ${role} "${name}"`);
  return el;
};

describe.skipIf(!available)("GNOME Wayland sandbox (live)", () => {
  let sb: WaylandSandbox;

  beforeAll(async () => {
    const r = await launchWaylandSandbox({
      appFor: (ctx) => testbedApp("host", ctx.sandboxWorkDir, "filled"),
    });
    if (!r.ok) throw new Error(r.error.message);
    sb = r.value;
    const opened = await sb.computer.open("desktop:app");
    if (!opened.ok) throw new Error(opened.error.message);
  });

  afterAll(async () => {
    await sb?.computer.close();
  });

  it("reports untrusted bounds and acts semantically", async () => {
    expect(sb.hello.platform).toBe("linux-wayland");
    expect(sb.hello.capabilities.boundsTrust).toBe("none");
    let s = await sb.computer.observe();
    if (!s.ok) throw new Error(s.error.message);
    const plan = find(s.value, "combobox", "Plan");
    expect(plan.boundsTrust).toBe("none");
    expect((await sb.computer.click({ token: plan.token })).error?.kind).toBe("unsupported");
    s = await sb.computer.observe();
    if (!s.ok) throw new Error(s.error.message);
    expect((await sb.computer.selectOption(find(s.value, "combobox", "Plan").token, "Team")).effect).toBe(
      "confirmed",
    );
    s = await sb.computer.observe();
    if (!s.ok) throw new Error(s.error.message);
    expect((await sb.computer.press(find(s.value, "button", "Save profile").token)).effect).toBe("confirmed");
    const state = JSON.parse(readFileSync(join(sb.workDir, "state.json"), "utf8")) as {
      profile: { plan: string };
    };
    expect(state.profile.plan).toBe("Team");
  });

  it("captures the virtual monitor over PipeWire when available", async () => {
    if (!sb.hello.capabilities.screenshots) return;
    const shot = await sb.computer.screenshot();
    expect(shot.ok).toBe(true);
    if (shot.ok) expect(shot.value.capture.width).toBe(1280);
  });
});
