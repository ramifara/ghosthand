// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { clampViewportForImages } from "./viewport.ts";

describe("clampViewportForImages", () => {
  it("keeps the longest side within TypeSafe's limit when screenshots go to Jev", () => {
    expect(clampViewportForImages({ width: 2560, height: 1440 }, "grounding")).toEqual({
      width: 1568,
      height: 882,
    });
    expect(clampViewportForImages({ width: 1280, height: 860 }, "always")).toEqual({
      width: 1280,
      height: 860,
    });
    expect(clampViewportForImages({ width: 200, height: 200 }, "always")).toEqual({
      width: 280,
      height: 280,
    });
  });
  it("leaves the viewport alone when images are off", () => {
    expect(clampViewportForImages({ width: 2560, height: 1440 }, "off")).toEqual({
      width: 2560,
      height: 1440,
    });
  });
});
