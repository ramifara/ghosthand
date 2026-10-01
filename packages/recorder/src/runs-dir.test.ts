// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { createRunId, RUN_ID_PATTERN } from "./run-id.ts";
import { defaultRunsDir } from "./runs-dir.ts";

describe("defaultRunsDir", () => {
  const home = "/home/u";
  it("uses XDG_DATA_HOME on Linux, falling back to ~/.local/share", () => {
    expect(defaultRunsDir({ env: { XDG_DATA_HOME: "/data" }, platform: "linux", home })).toBe(
      "/data/ghosthand/runs",
    );
    expect(defaultRunsDir({ env: {}, platform: "linux", home })).toBe("/home/u/.local/share/ghosthand/runs");
    expect(defaultRunsDir({ env: { XDG_DATA_HOME: "relative" }, platform: "linux", home })).toBe(
      "/home/u/.local/share/ghosthand/runs",
    );
  });

  it("uses Application Support on macOS and APPDATA on Windows", () => {
    expect(defaultRunsDir({ env: {}, platform: "darwin", home })).toBe(
      "/home/u/Library/Application Support/ghosthand/runs",
    );
    expect(
      defaultRunsDir({ env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, platform: "win32", home }),
    ).toBe("C:\\Users\\u\\AppData\\Roaming\\ghosthand\\runs");
  });

  it("honours GHOSTHAND_RUNS_DIR", () => {
    expect(defaultRunsDir({ env: { GHOSTHAND_RUNS_DIR: "/tmp/r" }, platform: "linux", home })).toBe("/tmp/r");
  });
});

describe("createRunId", () => {
  it("formats UTC time and a 6-char base36 suffix", () => {
    expect(createRunId(Date.UTC(2026, 9, 1, 7, 5, 9), "a1b2c3")).toBe("20261001-070509-a1b2c3");
    expect(createRunId()).toMatch(RUN_ID_PATTERN);
  });

  it("sorts by start time", () => {
    const a = createRunId(Date.UTC(2026, 0, 2, 23, 59, 59), "zzzzzz");
    const b = createRunId(Date.UTC(2026, 0, 3, 0, 0, 0), "000000");
    expect([b, a].sort()).toEqual([a, b]);
  });
});
