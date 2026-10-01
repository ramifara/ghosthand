// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Voice activity detection. Silero VAD (sherpa-onnx) when the addon and model are present; otherwise a
// pure-TS energy VAD with an adaptive noise floor. Inside push-to-talk, VAD only trims silence and splits
// utterances; it never starts listening by itself (no always-on mode in v1).
import { err, ok, type Result } from "@ghosthand/protocol";
import { rms, STT_SAMPLE_RATE, toDbfs } from "./audio.ts";
import { loadSherpa, type SherpaLoader, type SherpaVad } from "./sherpa.ts";

/** Half-open sample range [startSample, endSample) in the stream fed to the detector. */
export interface SpeechSegment {
  startSample: number;
  endSample: number;
}

export interface VoiceActivityDetector {
  readonly kind: "energy" | "silero";
  /** Feeds samples (16 kHz mono); returns segments that ended within them. */
  push(samples: Float32Array): SpeechSegment[];
  /** Ends the stream; returns a segment still open. */
  flush(): SpeechSegment[];
  /** True while inside a speech segment. */
  readonly speaking: boolean;
  reset(): void;
}

export interface EnergyVadConfig {
  sampleRate: number;
  frameMs: number;
  /** Speech must be this far above the noise floor. */
  marginDb: number;
  /** Frames quieter than this are never speech. */
  minSpeechDb: number;
  /** Consecutive loud time before a segment opens. */
  minSpeechMs: number;
  /** Quiet time before a segment closes. */
  hangoverMs: number;
  /** Audio kept before the first loud frame. */
  prerollMs: number;
  /** Audio kept after the last loud frame. */
  tailMs: number;
  /** Initial noise floor estimate. */
  initialNoiseDb: number;
}

export const DEFAULT_ENERGY_VAD: EnergyVadConfig = {
  sampleRate: STT_SAMPLE_RATE,
  frameMs: 20,
  marginDb: 12,
  minSpeechDb: -50,
  minSpeechMs: 100,
  hangoverMs: 400,
  prerollMs: 150,
  tailMs: 120,
  initialNoiseDb: -65,
};

const NOISE_CEILING_DB = -30;
const NOISE_EMA = 0.05;

export function createEnergyVad(config: Partial<EnergyVadConfig> = {}): VoiceActivityDetector {
  const c = { ...DEFAULT_ENERGY_VAD, ...config };
  const frame = Math.max(1, Math.round((c.sampleRate * c.frameMs) / 1000));
  const toFrames = (ms: number) => Math.max(1, Math.round(ms / c.frameMs));
  const minSpeechFrames = toFrames(c.minSpeechMs);
  const hangoverFrames = toFrames(c.hangoverMs);
  const preroll = Math.round((c.sampleRate * c.prerollMs) / 1000);
  const tail = Math.round((c.sampleRate * c.tailMs) / 1000);

  let pending = new Float32Array(0);
  let consumed = 0; // samples processed so far (frame-aligned)
  let noiseDb = c.initialNoiseDb;
  let speaking = false;
  let loudRun = 0;
  let firstLoudAt = 0;
  let lastLoudEnd = 0;
  let quietRun = 0;
  let segStart = 0;
  let lastEnd = 0;

  const close = (): SpeechSegment => {
    const seg = { startSample: segStart, endSample: Math.min(consumed, lastLoudEnd + tail) };
    lastEnd = seg.endSample;
    speaking = false;
    loudRun = 0;
    quietRun = 0;
    return seg;
  };

  const vad: VoiceActivityDetector = {
    kind: "energy",
    get speaking() {
      return speaking;
    },
    push(samples) {
      const buf = new Float32Array(pending.length + samples.length);
      buf.set(pending);
      buf.set(samples, pending.length);
      const out: SpeechSegment[] = [];
      let at = 0;
      for (; at + frame <= buf.length; at += frame) {
        const start = consumed;
        consumed += frame;
        const db = toDbfs(rms(buf, at, at + frame));
        const threshold = Math.max(c.minSpeechDb, noiseDb + c.marginDb);
        const loud = db >= threshold;
        if (loud) {
          if (loudRun === 0) firstLoudAt = start;
          loudRun++;
          quietRun = 0;
          lastLoudEnd = consumed;
          if (!speaking && loudRun >= minSpeechFrames) {
            speaking = true;
            segStart = Math.max(lastEnd, firstLoudAt - preroll, 0);
          }
        } else {
          loudRun = 0;
          // Track the floor: fast down, slow up, only outside speech.
          if (!speaking) noiseDb = db < noiseDb ? db : noiseDb + NOISE_EMA * (db - noiseDb);
          noiseDb = Math.min(noiseDb, NOISE_CEILING_DB);
          if (speaking && ++quietRun >= hangoverFrames) out.push(close());
        }
      }
      pending = buf.slice(at);
      return out;
    },
    flush() {
      const out = speaking ? [close()] : [];
      pending = new Float32Array(0);
      return out;
    },
    reset() {
      pending = new Float32Array(0);
      consumed = 0;
      noiseDb = c.initialNoiseDb;
      speaking = false;
      loudRun = 0;
      quietRun = 0;
      lastEnd = 0;
    },
  };
  return vad;
}

export interface SileroVadOptions {
  modelPath: string;
  threshold?: number;
  minSilenceMs?: number;
  minSpeechMs?: number;
  loader?: SherpaLoader;
}

/** Silero VAD window at 16 kHz (sherpa-onnx expects exactly this many samples per call). */
export const SILERO_WINDOW = 512;

export function createSileroVad(opts: SileroVadOptions): Result<VoiceActivityDetector, string> {
  const sherpa = (opts.loader ?? loadSherpa)();
  if (!sherpa.ok) return err(sherpa.error.message);
  let native: SherpaVad;
  try {
    native = new sherpa.value.Vad(
      {
        sileroVad: {
          model: opts.modelPath,
          threshold: opts.threshold ?? 0.5,
          minSpeechDuration: (opts.minSpeechMs ?? 150) / 1000,
          minSilenceDuration: (opts.minSilenceMs ?? 400) / 1000,
          windowSize: SILERO_WINDOW,
        },
        sampleRate: STT_SAMPLE_RATE,
        numThreads: 1,
        debug: false,
      },
      60,
    );
  } catch (e) {
    return err(`cannot load Silero VAD: ${e instanceof Error ? e.message : String(e)}`);
  }
  let pending = new Float32Array(0);
  const drain = (): SpeechSegment[] => {
    const out: SpeechSegment[] = [];
    while (!native.isEmpty()) {
      const seg = native.front(false);
      out.push({ startSample: seg.start, endSample: seg.start + seg.samples.length });
      native.pop();
    }
    return out;
  };
  return ok({
    kind: "silero",
    get speaking() {
      return native.isDetected();
    },
    push(samples) {
      const buf = new Float32Array(pending.length + samples.length);
      buf.set(pending);
      buf.set(samples, pending.length);
      let at = 0;
      for (; at + SILERO_WINDOW <= buf.length; at += SILERO_WINDOW)
        native.acceptWaveform(buf.subarray(at, at + SILERO_WINDOW));
      pending = buf.slice(at);
      return drain();
    },
    flush() {
      native.flush();
      pending = new Float32Array(0);
      return drain();
    },
    reset() {
      native.reset();
      pending = new Float32Array(0);
    },
  });
}

/** Runs a detector over a whole buffer (utterance segmentation). */
export function segmentSpeech(
  samples: Float32Array,
  vad: VoiceActivityDetector = createEnergyVad(),
): SpeechSegment[] {
  vad.reset();
  return [...vad.push(samples), ...vad.flush()];
}

/** The span from the first speech start to the last speech end; undefined when nothing was said. */
export function trimSilence(
  samples: Float32Array,
  vad: VoiceActivityDetector = createEnergyVad(),
): Float32Array | undefined {
  const segs = segmentSpeech(samples, vad);
  const first = segs[0];
  const last = segs[segs.length - 1];
  if (!first || !last) return undefined;
  return samples.subarray(first.startSample, last.endSample);
}
