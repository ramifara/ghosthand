// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { launchOrigins } from "./commands/run.ts";
import { parse, runFlags } from "./main.ts";

describe("ghosthand run --allow-origin", () => {
  it("keeps every --allow-origin flag", () => {
    const flags = runFlags(
      parse([
        "run",
        "--url",
        "https://app.test",
        "--allow-origin",
        "https://auth.app.test",
        "--allow-origin",
        "*.cdn.test",
        "Open the dashboard",
      ]),
    );
    expect(flags.allowOrigins).toEqual(["https://auth.app.test", "*.cdn.test"]);
    expect(flags.goal).toBe("Open the dashboard");
    expect(runFlags(parse(["run", "--task", "l1-login"])).allowOrigins).toEqual([]);
  });

  it("passes the task allowlist plus the flags to the browser launcher", () => {
    const task = TaskSpec.parse({
      id: "l1-login",
      instruction: "Sign in",
      startUrl: "http://127.0.0.1:4400/login",
      allowOrigins: ["http://127.0.0.1:4400"],
    });
    expect(launchOrigins(task, ["https://auth.app.test", "http://127.0.0.1:4400"])).toEqual([
      "http://127.0.0.1:4400",
      "https://auth.app.test",
    ]);
  });
});

describe("ghosthand run --surface", () => {
  it("parses desktop flags", () => {
    const flags = runFlags(
      parse([
        "run",
        "--surface",
        "x11",
        "--app",
        "gnome-calculator --mode basic",
        "--runtime",
        "docker",
        "--vnc-port",
        "6080",
        "--network",
        "Add 2 and 3",
      ]),
    );
    expect(flags).toMatchObject({
      surface: "x11",
      app: "gnome-calculator --mode basic",
      runtime: "docker",
      vncPort: 6080,
      network: true,
      goal: "Add 2 and 3",
    });
    expect(runFlags(parse(["run", "--task", "l1-login"])).surface).toBeUndefined();
  });

  it("rejects unknown surfaces and runtimes", () => {
    expect(() => runFlags(parse(["run", "--surface", "amiga", "x"]))).toThrow(/--surface/);
    expect(() => runFlags(parse(["run", "--surface", "x11", "--runtime", "vm", "x"]))).toThrow(/--runtime/);
  });
});
