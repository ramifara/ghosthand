// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import type { SystemProbe } from "./system.ts";
import { containerArgs, detectRuntime, imageInputs, imageTag, launchX11Sandbox } from "./x11-sandbox.ts";

const fakeSystem = (over: Partial<SystemProbe> & { have?: string[]; infoOk?: string[] }): SystemProbe => ({
  platform: "linux",
  env: {},
  which: (c) => ((over.have ?? []).includes(c) ? `/usr/bin/${c}` : undefined),
  run: async (c) => ({ code: (over.infoOk ?? []).includes(c) ? 0 : 1, stdout: "", stderr: "" }),
  ...over,
});

describe("container arguments", () => {
  const base = {
    runtime: "docker" as const,
    image: "ghosthand-x11:abc",
    name: "gh-1",
    workDir: "/tmp/w",
    width: 1280,
    height: 800,
    wm: "auto",
    network: false,
  };

  it("isolates by default: no network, no capabilities, private work folder", () => {
    const a = containerArgs(base);
    expect(a).toEqual(expect.arrayContaining(["--network", "none", "--cap-drop", "ALL", "--rm", "-i"]));
    expect(a).toContain("/tmp/w:/work:rw");
    expect(a.slice(a.indexOf("ghosthand-x11:abc"))).toEqual([
      "ghosthand-x11:abc",
      "--display",
      ":1",
      "--size",
      "1280x800",
      "--wm",
      "auto",
    ]);
  });

  it("publishes noVNC on loopback only", () => {
    const a = containerArgs({ ...base, vncPort: 6080 });
    expect(a).toContain("127.0.0.1:6080:6080");
    expect(a).not.toContain("--network");
    expect(a.slice(-2)).toEqual(["--vnc-port", "6080"]);
  });

  it("maps users for podman and non-1000 docker users", () => {
    expect(containerArgs({ ...base, runtime: "podman" })).toEqual(
      expect.arrayContaining(["--userns", "keep-id"]),
    );
    expect(containerArgs({ ...base, uid: 1234, gid: 99 })).toEqual(
      expect.arrayContaining(["--user", "1234:99"]),
    );
    expect(containerArgs({ ...base, uid: 1000, gid: 1000 })).not.toContain("--user");
  });
});

describe("image tag", () => {
  it("hashes the Containerfile, host and testbed sources", () => {
    const files = imageInputs();
    expect(files.some((f) => f.endsWith("Containerfile"))).toBe(true);
    expect(files.some((f) => f.endsWith("host.py"))).toBe(true);
    expect(files.some((f) => f.endsWith("desktop-testbed.py"))).toBe(true);
    expect(imageTag()).toMatch(/^[0-9a-f]{12}$/);
    expect(imageTag()).toBe(imageTag());
  });
});

describe("runtime detection", () => {
  it("prefers a working docker, then podman, then host Xvfb", async () => {
    expect(await detectRuntime(fakeSystem({ have: ["docker", "podman"], infoOk: ["docker"] }))).toBe(
      "docker",
    );
    expect(await detectRuntime(fakeSystem({ have: ["docker", "podman"], infoOk: ["podman"] }))).toBe(
      "podman",
    );
    expect(
      await detectRuntime(
        fakeSystem({ have: ["docker", "Xvfb", "python3", "dbus-run-session"], infoOk: [] }),
      ),
    ).toBe("host");
    expect(await detectRuntime(fakeSystem({ have: [] }))).toBeUndefined();
  });

  it("fails clearly off Linux or without any runtime", async () => {
    const mac = await launchX11Sandbox({ system: fakeSystem({ platform: "darwin" }) });
    expect(mac).toMatchObject({ ok: false, error: { kind: "launch_failed" } });
    const none = await launchX11Sandbox({ system: fakeSystem({}) });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.message).toMatch(/docker\/podman/);
  });
});
