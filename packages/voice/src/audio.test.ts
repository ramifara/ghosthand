// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { concatChunks, decodeWav, encodeWav, resample, rms, toDbfs } from "./audio.ts";

const fixture = new URL("./__fixtures__/tone-noise.wav", import.meta.url);

describe("audio", () => {
  it("decodes the 16-bit fixture", () => {
    const r = decodeWav(readFileSync(fixture));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sampleRate).toBe(16_000);
    expect(r.value.samples.length).toBe(12_800);
    expect(toDbfs(rms(r.value.samples, 4000, 8000))).toBeGreaterThan(-20);
    expect(toDbfs(rms(r.value.samples, 0, 3000))).toBeLessThan(-45);
  });

  it("round-trips encode/decode within 16-bit precision", () => {
    const s = Float32Array.from({ length: 100 }, (_, i) => Math.sin(i / 5) * 0.8);
    const r = decodeWav(encodeWav(s, 8000));
    expect(r.ok && r.value.sampleRate).toBe(8000);
    if (r.ok) for (let i = 0; i < s.length; i++) expect(r.value.samples[i]).toBeCloseTo(s[i] ?? 0, 3);
  });

  it("averages stereo and decodes float WAV", () => {
    const frames = 4;
    const bytes = new Uint8Array(44 + frames * 8);
    const v = new DataView(bytes.buffer);
    const put = (at: number, s: string) => {
      for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
    };
    put(0, "RIFF");
    v.setUint32(4, 36 + frames * 8, true);
    put(8, "WAVE");
    put(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 3, true);
    v.setUint16(22, 2, true);
    v.setUint32(24, 16_000, true);
    v.setUint32(28, 16_000 * 8, true);
    v.setUint16(32, 8, true);
    v.setUint16(34, 32, true);
    put(36, "data");
    v.setUint32(40, frames * 8, true);
    for (let i = 0; i < frames; i++) {
      v.setFloat32(44 + i * 8, 0.5, true);
      v.setFloat32(48 + i * 8, -0.1, true);
    }
    const r = decodeWav(bytes);
    expect(r.ok && Array.from(r.value.samples).map((x) => Number(x.toFixed(3)))).toEqual([
      0.2, 0.2, 0.2, 0.2,
    ]);
  });

  it("rejects non-WAV input", () => {
    expect(decodeWav(new TextEncoder().encode("hello world, not audio"))).toEqual({
      ok: false,
      error: { kind: "invalid_wav", message: "not a RIFF/WAVE file" },
    });
  });

  it("resamples and concatenates", () => {
    const s48 = new Float32Array(4800).fill(0.25);
    expect(resample(s48, 48_000, 16_000).length).toBe(1600);
    const joined = concatChunks([
      { samples: new Float32Array(160).fill(0.1), sampleRate: 16_000 },
      { samples: new Float32Array(480).fill(0.2), sampleRate: 48_000 },
    ]);
    expect(joined.length).toBe(320);
    expect(joined[319]).toBeCloseTo(0.2);
  });
});
