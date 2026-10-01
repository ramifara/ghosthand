// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Deterministic synthetic audio for tests: tones stand in for speech, seeded noise for room noise.
import { STT_SAMPLE_RATE } from "../audio.ts";

const samplesFor = (ms: number, rate = STT_SAMPLE_RATE) => Math.round((ms * rate) / 1000);

/** A sine "voice" with a slow amplitude wobble (so it is not a flat-energy signal). */
export function tone(ms: number, amp = 0.25, freq = 220, rate = STT_SAMPLE_RATE): Float32Array {
  const n = samplesFor(ms, rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = 0.75 + 0.25 * Math.sin(2 * Math.PI * 4 * t);
    out[i] = amp * env * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 2.7 * t));
  }
  return out;
}

/** Seeded uniform noise (mulberry32). */
export function noise(ms: number, amp = 0.003, seed = 7, rate = STT_SAMPLE_RATE): Float32Array {
  const n = samplesFor(ms, rate);
  const out = new Float32Array(n);
  let a = seed >>> 0;
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = amp * ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1);
  }
  return out;
}

export function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Adds low background noise under a signal. */
export function withNoise(signal: Float32Array, amp = 0.003, seed = 11): Float32Array {
  const bg = noise((signal.length / STT_SAMPLE_RATE) * 1000 + 1, amp, seed);
  return signal.map((v, i) => v + (bg[i] ?? 0));
}

export const ms = (samples: number) => (samples / STT_SAMPLE_RATE) * 1000;
