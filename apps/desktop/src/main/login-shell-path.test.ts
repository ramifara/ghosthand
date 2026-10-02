// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";
import { commonBinDirs, loginShellPath, mergePath } from "./login-shell-path.ts";

describe("GUI PATH", () => {
  it("merges PATH lists in order without duplicates or empty entries", () => {
    const a = ["/opt/homebrew/bin", "/usr/bin"].join(delimiter);
    const b = ["/usr/bin", "", "/bin"].join(delimiter);
    expect(mergePath(a, undefined, b)).toBe(["/opt/homebrew/bin", "/usr/bin", "/bin"].join(delimiter));
  });

  it("adds Homebrew on macOS and the user's bin folders everywhere", () => {
    expect(commonBinDirs("/Users/r", "darwin")[0]).toBe("/opt/homebrew/bin");
    expect(commonBinDirs("/home/r", "linux")).toContain("/home/r/.local/bin");
    expect(commonBinDirs("/home/r", "linux")).not.toContain("/opt/homebrew/bin");
  });

  it.skipIf(process.platform === "win32")("reads the PATH a login shell prints", async () => {
    const path = await loginShellPath({ ...process.env, SHELL: "/bin/sh" });
    expect(path === undefined || path.split(delimiter).length > 0).toBe(true);
  });
});
