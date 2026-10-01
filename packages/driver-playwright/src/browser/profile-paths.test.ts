// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { validateProfileName } from "./profile-name.ts";
import { defaultProfilesRoot } from "./profile-paths.ts";

describe("defaultProfilesRoot", () => {
  it("uses ~/.local/share on Linux", () => {
    expect(defaultProfilesRoot({ platform: "linux", env: {}, homedir: "/home/rami" })).toBe(
      "/home/rami/.local/share/ghosthand/profiles",
    );
  });

  it("respects an absolute XDG_DATA_HOME and ignores a relative one", () => {
    expect(
      defaultProfilesRoot({ platform: "linux", env: { XDG_DATA_HOME: "/data" }, homedir: "/home/rami" }),
    ).toBe("/data/ghosthand/profiles");
    expect(
      defaultProfilesRoot({ platform: "linux", env: { XDG_DATA_HOME: "rel" }, homedir: "/home/rami" }),
    ).toBe("/home/rami/.local/share/ghosthand/profiles");
  });

  it("uses %APPDATA% on Windows", () => {
    expect(
      defaultProfilesRoot({
        platform: "win32",
        env: { APPDATA: "C:\\Users\\rami\\AppData\\Roaming" },
        homedir: "C:\\Users\\rami",
      }),
    ).toBe("C:\\Users\\rami\\AppData\\Roaming\\ghosthand\\profiles");
    expect(defaultProfilesRoot({ platform: "win32", env: {}, homedir: "C:\\Users\\rami" })).toBe(
      "C:\\Users\\rami\\AppData\\Roaming\\ghosthand\\profiles",
    );
  });

  it("uses Application Support on macOS", () => {
    expect(defaultProfilesRoot({ platform: "darwin", env: {}, homedir: "/Users/rami" })).toBe(
      "/Users/rami/Library/Application Support/ghosthand/profiles",
    );
  });
});

describe("validateProfileName", () => {
  it.each(["default", "work", "acme-staging", "user2", "a", "x".repeat(64)])("accepts %s", (name) => {
    expect(validateProfileName(name)).toEqual({ ok: true, value: name });
  });

  it.each([
    "",
    "Work",
    "my profile",
    "-lead",
    "trail-",
    "double--dash",
    "dot.name",
    "../escape",
    "a/b",
    "a\\b",
    "under_score",
    "x".repeat(65),
  ])("rejects %j", (name) => {
    const result = validateProfileName(name);
    expect(!result.ok && result.error.kind).toBe("invalid_name");
  });
});
