// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Minimal PNG and JPEG byte strings for tests: a correct signature and size header, no pixel data.
// Not exported from the package.

/** A PNG signature plus an IHDR chunk declaring `width` × `height`, padded to `bytes`. */
export function fakePng(width: number, height: number, bytes = 64): Uint8Array {
  const out = new Uint8Array(Math.max(bytes, 33));
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13); // IHDR length
  out.set([73, 72, 68, 82], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return out;
}

/** A JPEG SOI marker, an APP0 segment and a SOF0 frame header declaring `width` × `height`. */
export function fakeJpeg(width: number, height: number, bytes = 64): Uint8Array {
  const out = new Uint8Array(Math.max(bytes, 40));
  let i = 0;
  out.set([0xff, 0xd8], i); // SOI
  i += 2;
  out.set([0xff, 0xe0, 0x00, 0x10], i); // APP0, length 16
  i += 2 + 16;
  out.set([0xff, 0xc0, 0x00, 0x11, 0x08], i); // SOF0, length 17, precision 8
  i += 5;
  const view = new DataView(out.buffer);
  view.setUint16(i, height);
  view.setUint16(i + 2, width);
  return out;
}
