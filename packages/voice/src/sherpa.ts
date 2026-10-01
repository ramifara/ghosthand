// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Loads the optional `sherpa-onnx-node` N-API addon (Apache-2.0, prebuilt for linux/mac/win x64 and arm64)
// at runtime. It is an optionalDependency: when it is missing or fails to load, local STT and Silero VAD
// report `unavailable` and everything else keeps working.
import { createRequire } from "node:module";
import { err, ok, type Result } from "@ghosthand/protocol";

export const SHERPA_PACKAGE = "sherpa-onnx-node";

export interface SherpaWave {
  samples: Float32Array;
  sampleRate: number;
}

export interface SherpaOfflineStream {
  acceptWaveform(wave: SherpaWave): void;
}

export interface SherpaOfflineResult {
  text: string;
  tokens?: string[];
  timestamps?: number[];
  lang?: string;
}

export interface SherpaOfflineRecognizer {
  createStream(): SherpaOfflineStream;
  decodeAsync(stream: SherpaOfflineStream): Promise<SherpaOfflineResult>;
}

export interface SherpaSpeechSegment {
  start: number;
  samples: Float32Array;
}

export interface SherpaVad {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  isDetected(): boolean;
  front(enableExternalBuffer?: boolean): SherpaSpeechSegment;
  pop(): void;
  flush(): void;
  reset(): void;
}

/** The subset of the addon GhostHand uses. */
export interface SherpaModule {
  OfflineRecognizer: { createAsync(config: unknown): Promise<SherpaOfflineRecognizer> };
  Vad: new (config: unknown, bufferSizeInSeconds: number) => SherpaVad;
  version?: string;
}

export type SherpaLoadError = { kind: "unavailable"; message: string };
export type SherpaLoader = () => Result<SherpaModule, SherpaLoadError>;

let cached: Result<SherpaModule, SherpaLoadError> | undefined;

function isSherpaModule(m: unknown): m is SherpaModule {
  if (m === null || typeof m !== "object") return false;
  const rec = (m as { OfflineRecognizer?: unknown }).OfflineRecognizer;
  const vad = (m as { Vad?: unknown }).Vad;
  return (
    typeof rec === "function" &&
    typeof (rec as { createAsync?: unknown }).createAsync === "function" &&
    typeof vad === "function"
  );
}

/** Loads the addon once per process. */
export const loadSherpa: SherpaLoader = () => {
  if (cached) return cached;
  try {
    const require = createRequire(import.meta.url);
    const mod: unknown = require(SHERPA_PACKAGE);
    cached = isSherpaModule(mod)
      ? ok(mod)
      : err({ kind: "unavailable", message: `${SHERPA_PACKAGE} loaded but has an unexpected API` });
  } catch (e) {
    const detail = e instanceof Error ? (e.message.split("\n")[0] ?? e.message) : String(e);
    cached = err({
      kind: "unavailable",
      message: `${SHERPA_PACKAGE} is not installed or cannot load on ${process.platform}-${process.arch}: ${detail}`,
    });
  }
  return cached;
};

/** Version string of the loaded addon, or undefined when it is not available. */
export function sherpaVersion(loader: SherpaLoader = loadSherpa): string | undefined {
  const m = loader();
  return m.ok ? (m.value.version ?? "unknown") : undefined;
}
