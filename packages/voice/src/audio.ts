// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Mono float PCM helpers: chunk concatenation, resampling, levels and RIFF/WAV encode/decode.
// Every STT backend takes 16 kHz mono float samples in [-1, 1].
import { err, ok, type Result } from "@ghosthand/protocol";

export const STT_SAMPLE_RATE = 16_000;

/** One block of mono samples in [-1, 1] at `sampleRate`. */
export interface PcmChunk {
  samples: Float32Array;
  sampleRate: number;
}

export type AudioInput = PcmChunk[] | Float32Array;

/** Joins chunks into one buffer at `sampleRate` (chunks at another rate are resampled first). */
export function concatChunks(chunks: readonly PcmChunk[], sampleRate = STT_SAMPLE_RATE): Float32Array {
  const parts = chunks.map((c) =>
    c.sampleRate === sampleRate ? c.samples : resample(c.samples, c.sampleRate, sampleRate),
  );
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A Float32Array is taken to be 16 kHz already. */
export const toSamples = (audio: AudioInput): Float32Array =>
  audio instanceof Float32Array ? audio : concatChunks(audio);

/** Linear-interpolation resampler; good enough for speech going into 16 kHz models. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) return samples;
  const ratio = from / to;
  const n = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = samples[j] ?? 0;
    const b = samples[j + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

export function rms(samples: Float32Array, start = 0, end = samples.length): number {
  const n = end - start;
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/** Level in dBFS; silence floors at -120. */
export const toDbfs = (level: number): number => (level <= 1e-6 ? -120 : 20 * Math.log10(level));

export const durationMs = (samples: number, sampleRate = STT_SAMPLE_RATE): number =>
  (samples / sampleRate) * 1000;

// ---------------------------------------------------------------------------------------------------------
// WAV

export type WavError = { kind: "invalid_wav"; message: string };

const invalid = (message: string): Result<never, WavError> => err({ kind: "invalid_wav", message });

/**
 * Decodes PCM 8/16/24/32-bit integer or 32-bit float WAV, any channel count (averaged to mono).
 * Returns samples at the file's own rate.
 */
export function decodeWav(bytes: Uint8Array): Result<PcmChunk, WavError> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return invalid("not a RIFF/WAVE file");
  let at = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | undefined;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      if (size < 16) return invalid("fmt chunk too short");
      let audioFormat = view.getUint16(body, true);
      if (audioFormat === 0xfffe && size >= 40) audioFormat = view.getUint16(body + 24, true);
      format = {
        audioFormat,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!format) return invalid("data chunk before fmt chunk");
      const end = Math.min(bytes.length, body + size);
      return decodeData(view, body, end, format);
    }
    at = body + size + (size % 2);
  }
  return invalid("no data chunk");
}

function decodeData(
  view: DataView,
  start: number,
  end: number,
  f: { audioFormat: number; channels: number; sampleRate: number; bits: number },
): Result<PcmChunk, WavError> {
  if (f.channels < 1) return invalid("zero channels");
  if (f.sampleRate < 1000) return invalid(`sample rate ${f.sampleRate} too low`);
  const bytesPer = f.bits / 8;
  const isFloat = f.audioFormat === 3;
  if (!(f.audioFormat === 1 || isFloat)) return invalid(`unsupported WAV format ${f.audioFormat}`);
  if (isFloat && f.bits !== 32) return invalid(`unsupported float width ${f.bits}`);
  if (!isFloat && ![8, 16, 24, 32].includes(f.bits)) return invalid(`unsupported bit depth ${f.bits}`);
  const frame = bytesPer * f.channels;
  const frames = Math.floor((end - start) / frame);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < f.channels; c++)
      sum += readSample(view, start + i * frame + c * bytesPer, f.bits, isFloat);
    out[i] = sum / f.channels;
  }
  return ok({ samples: out, sampleRate: f.sampleRate });
}

function readSample(view: DataView, at: number, bits: number, isFloat: boolean): number {
  if (isFloat) return view.getFloat32(at, true);
  switch (bits) {
    case 8:
      return (view.getUint8(at) - 128) / 128;
    case 16:
      return view.getInt16(at, true) / 32768;
    case 24: {
      const v = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16);
      return v / 8388608;
    }
    default:
      return view.getInt32(at, true) / 2147483648;
  }
}

/** Encodes mono 16-bit PCM WAV (what hosted STT APIs accept everywhere). */
export function encodeWav(samples: Float32Array, sampleRate = STT_SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const write = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, v < 0 ? v * 32768 : v * 32767, true);
  }
  return bytes;
}
