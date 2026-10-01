// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors

import { err, ok } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { join, ms, noise, tone, withNoise } from "./__fixtures__/synthetic-audio.ts";
import type { SherpaModule, SherpaVad } from "./sherpa.ts";
import { createEnergyVad, createSileroVad, SILERO_WINDOW, segmentSpeech, trimSilence } from "./vad.ts";

// noise 1000 | voice 800 | noise 600 | voice 500 | noise 1000   (ms)
const audio = withNoise(join(noise(1000, 0), tone(800), noise(600, 0), tone(500, 0.15, 180), noise(1000, 0)));

describe("energy VAD", () => {
  it("finds two utterances in synthetic audio with ~±150 ms boundaries", () => {
    const segs = segmentSpeech(audio);
    expect(segs).toHaveLength(2);
    const [a, b] = segs.map((s) => ({ start: ms(s.startSample), end: ms(s.endSample) }));
    expect(a?.start).toBeGreaterThan(1000 - 200);
    expect(a?.start).toBeLessThanOrEqual(1000);
    expect(a?.end).toBeGreaterThanOrEqual(1800);
    expect(a?.end).toBeLessThan(1800 + 200);
    expect(b?.start).toBeGreaterThan(2400 - 200);
    expect(b?.end).toBeLessThan(2900 + 200);
  });

  it("gives the same answer when fed in small chunks", () => {
    const vad = createEnergyVad();
    const segs = [];
    for (let i = 0; i < audio.length; i += 333) segs.push(...vad.push(audio.subarray(i, i + 333)));
    segs.push(...vad.flush());
    expect(segs).toEqual(segmentSpeech(audio));
  });

  it("ignores noise-only input and very short clicks", () => {
    expect(segmentSpeech(noise(2000, 0.004))).toEqual([]);
    expect(segmentSpeech(join(noise(500), tone(40, 0.5), noise(500)))).toEqual([]);
  });

  it("closes a segment still open at the end of the stream", () => {
    const segs = segmentSpeech(join(noise(300), tone(600)));
    expect(segs).toHaveLength(1);
    expect(ms(segs[0]?.endSample ?? 0)).toBeCloseTo(900, -1);
  });

  it("trims leading and trailing silence", () => {
    const trimmed = trimSilence(audio);
    expect(trimmed).toBeDefined();
    expect(ms(trimmed?.length ?? 0)).toBeGreaterThan(1800);
    expect(ms(trimmed?.length ?? 0)).toBeLessThan(2400);
    expect(trimSilence(noise(1000))).toBeUndefined();
  });

  it("tracks the noise floor in a louder room", () => {
    const loud = withNoise(join(noise(1000, 0), tone(700, 0.3), noise(1000, 0)), 0.02);
    expect(segmentSpeech(loud)).toHaveLength(1);
  });
});

describe("Silero VAD wrapper", () => {
  it("reports unavailable when the addon cannot load", () => {
    const r = createSileroVad({
      modelPath: "/nope",
      loader: () => err({ kind: "unavailable", message: "no addon" }),
    });
    expect(r).toEqual({ ok: false, error: "no addon" });
  });

  it("feeds fixed 512-sample windows and drains segments", () => {
    const fed: number[] = [];
    const queue: Array<{ start: number; samples: Float32Array }> = [];
    const native: SherpaVad = {
      acceptWaveform: (s) => {
        fed.push(s.length);
        if (fed.length === 3) queue.push({ start: 512, samples: new Float32Array(1024) });
      },
      isEmpty: () => queue.length === 0,
      isDetected: () => false,
      front: () => queue[0] ?? { start: 0, samples: new Float32Array(0) },
      pop: () => {
        queue.shift();
      },
      flush: () => {},
      reset: () => {},
    };
    const mod = {
      OfflineRecognizer: { createAsync: () => Promise.reject(new Error("unused")) },
      Vad: function FakeVad() {
        return native;
      },
    } as unknown as SherpaModule;
    const vad = createSileroVad({ modelPath: "silero_vad.onnx", loader: () => ok(mod) });
    expect(vad.ok).toBe(true);
    if (!vad.ok) return;
    expect(vad.value.push(new Float32Array(1000))).toEqual([]);
    expect(vad.value.push(new Float32Array(600))).toEqual([{ startSample: 512, endSample: 1536 }]);
    expect(fed).toEqual([SILERO_WINDOW, SILERO_WINDOW, SILERO_WINDOW]);
  });
});
