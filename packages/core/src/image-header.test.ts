// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { readImageSize, sniffImageType } from "./image-header.ts";
import { fakeJpeg, fakePng } from "./testing/fake-images.ts";

describe("sniffImageType", () => {
  it("recognises PNG and JPEG signatures and nothing else", () => {
    expect(sniffImageType(fakePng(300, 300))).toBe("image/png");
    expect(sniffImageType(fakeJpeg(300, 300))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeUndefined();
    expect(sniffImageType(new Uint8Array(2))).toBeUndefined();
  });
});

describe("readImageSize", () => {
  it("reads PNG IHDR and JPEG SOF dimensions", () => {
    expect(readImageSize(fakePng(1280, 834))).toEqual({ width: 1280, height: 834 });
    expect(readImageSize(fakeJpeg(640, 417))).toEqual({ width: 640, height: 417 });
    expect(readImageSize(new Uint8Array(10))).toBeUndefined();
  });
});
