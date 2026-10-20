// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screenshotName } from "./run-folder.ts";
import { findScreenshot, listScreenshotSteps } from "./screenshot-files.ts";
import { tempDir } from "./test-support.ts";

describe("screenshotName", () => {
  it("names PNG and JPEG captures, with an optional label for extra captures", () => {
    expect(screenshotName(1)).toBe("step-001.png");
    expect(screenshotName(1, "image/jpeg")).toBe("step-001.jpg");
    expect(screenshotName(12, "image/jpeg", "d0")).toBe("step-012-d0.jpg");
    expect(screenshotName(3, "image/png", "d0 region")).toBe("step-003-d0-region.png");
  });
});

describe("screenshot files in a run folder", () => {
  let tmp: ReturnType<typeof tempDir>;
  beforeEach(() => {
    tmp = tempDir();
    mkdirSync(join(tmp.dir, "screenshots"));
    for (const f of ["step-001.png", "step-002.jpg", "step-002-d0.jpg", "step-010.jpg", "notes.txt"])
      writeFileSync(join(tmp.dir, "screenshots", f), "x");
  });
  afterEach(() => tmp.cleanup());

  it("lists the steps that have a main screenshot, PNG or JPEG, ignoring extra captures", () => {
    expect(listScreenshotSteps(tmp.dir)).toEqual([1, 2, 10]);
    expect(listScreenshotSteps(join(tmp.dir, "missing"))).toEqual([]);
  });

  it("finds a step's screenshot file and its media type", () => {
    expect(findScreenshot(tmp.dir, 1)).toEqual({
      file: join(tmp.dir, "screenshots", "step-001.png"),
      mimeType: "image/png",
    });
    expect(findScreenshot(tmp.dir, 2)).toEqual({
      file: join(tmp.dir, "screenshots", "step-002.jpg"),
      mimeType: "image/jpeg",
    });
    expect(findScreenshot(tmp.dir, 3)).toBeUndefined();
  });
});
