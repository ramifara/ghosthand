// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { Capture } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { boxCentre, DECISION_SCREENSHOT_OPTIONS, prepareForDecision, SCREEN_REF } from "./screen-image.ts";
import { fakeJpeg, fakePng } from "./testing/fake-images.ts";

const capture = (over: Partial<Capture> = {}): Capture => ({
  id: "c1",
  takenAt: 1,
  mimeType: "image/jpeg",
  width: 1280,
  height: 834,
  scale: 1,
  ...over,
});

describe("DECISION_SCREENSHOT_OPTIONS", () => {
  it("asks drivers for a masked JPEG at CSS scale within TypeSafe's longest side", () => {
    expect(DECISION_SCREENSHOT_OPTIONS).toEqual({
      format: "jpeg",
      quality: 80,
      maxSide: 1568,
      mask: "secrets",
    });
  });
});

describe("prepareForDecision", () => {
  it("turns a capture into a decision image under the screen ref", () => {
    const data = fakeJpeg(1280, 834);
    const r = prepareForDecision({ capture: capture(), data });
    if (!r.ok) throw new Error(r.error.kind);
    expect(r.value).toEqual({
      ref: SCREEN_REF,
      mimeType: "image/jpeg",
      width: 1280,
      height: 834,
      captureId: "c1",
      data,
    });
  });

  it("accepts a custom ref", () => {
    const r = prepareForDecision(
      { capture: capture(), data: fakeJpeg(1280, 834) },
      { ref: "<image:region>" },
    );
    expect(r.ok && r.value.ref).toBe("<image:region>");
  });

  it.each([
    ["too_large", capture({ width: 1600, height: 900 }), fakeJpeg(1600, 900)],
    ["too_small", capture({ width: 200, height: 300 }), fakeJpeg(200, 300)],
    ["unsupported", capture({ mimeType: "image/png" }), fakeJpeg(1280, 834)],
    ["unsupported", capture(), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])],
  ])("fails with %s", (kind, cap, data) => {
    const r = prepareForDecision({ capture: cap, data });
    expect(r.ok ? undefined : r.error.kind).toBe(kind);
  });

  it("trusts the bytes over the capture's declared size", () => {
    const r = prepareForDecision(
      { capture: capture({ width: 999, height: 999 }), data: fakePng(1280, 834) },
      {},
    );
    expect(r.ok ? undefined : r.error.kind).toBe("unsupported");
  });
});

describe("boxCentre", () => {
  it("maps box fractions to a capture-pixel click target", () => {
    const t = boxCentre(
      { top: 0.75, bottom: 0.79, left: 0.19, right: 0.3 },
      capture({ width: 1100, height: 717 }),
    );
    expect(t).toEqual({ captureId: "c1", x: Math.round(0.245 * 1100), y: Math.round(0.77 * 717) });
  });
});
