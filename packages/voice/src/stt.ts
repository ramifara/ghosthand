// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The speech-to-text contract every backend implements (local sherpa-onnx models and hosted APIs).
import type { Result } from "@ghosthand/protocol";
import type { AudioInput } from "./audio.ts";

export const STT_BACKENDS = [
  "moonshine",
  "whisper",
  "openai",
  "deepgram",
  "gemini",
  "assemblyai",
  "elevenlabs",
  "openrouter",
] as const;
export type SttBackendId = (typeof STT_BACKENDS)[number];

export const isSttBackendId = (s: string): s is SttBackendId =>
  (STT_BACKENDS as readonly string[]).includes(s);

export interface SttSegment {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface SttResult {
  text: string;
  segments?: SttSegment[];
  latencyMs: number;
  /** Model id that produced the text (e.g. "moonshine-tiny-en", "gpt-transcribe", "nova-3"). */
  model: string;
  /** Backend that answered. */
  backend: SttBackendId;
  /** Audio length sent, ms (for cost and RTF). */
  audioMs: number;
}

export type SttErrorKind =
  /** Native module or model files missing, or the platform is not supported. */
  | "unavailable"
  /** No API key / model configured for this backend. */
  | "not_configured"
  | "auth"
  | "rate_limit"
  | "invalid_audio"
  | "timeout"
  | "aborted"
  | "network"
  | "server"
  | "provider";

export interface SttError {
  kind: SttErrorKind;
  message: string;
  backend: SttBackendId;
  status?: number;
}

export interface TranscribeOptions {
  /** BCP-47 / ISO-639-1 code ("en"); backends that auto-detect may ignore it. */
  language?: string;
  /** Biasing terms: grammar verbs and visible element names (Deepgram keyterms, OpenAI prompt). */
  keyterms?: string[];
  signal?: AbortSignal;
}

export interface SttCapabilities {
  local: boolean;
  /** Emits partial transcripts while audio is still arriving. */
  streaming: boolean;
  /** Accepts biasing terms. */
  keyterms: boolean;
  languages: "multilingual" | string[];
  /** USD per audio minute; 0 for local models. */
  usdPerMinute: number;
}

export interface SpeechToText {
  readonly id: SttBackendId;
  readonly model: string;
  readonly capabilities: SttCapabilities;
  transcribe(audio: AudioInput, opts?: TranscribeOptions): Promise<Result<SttResult, SttError>>;
  /** Frees native resources (local backends). */
  close?(): void;
}

/** Maps an HTTP status to an STT error kind. */
export function sttKindForStatus(status: number): SttErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 413 || status === 415 || status === 422) return "invalid_audio";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "server";
  return "provider";
}

/** Converts a thrown fetch/abort error into an SttError. */
export function sttErrorFromException(e: unknown, backend: SttBackendId, signal?: AbortSignal): SttError {
  const name = e instanceof Error ? e.name : "";
  const message = e instanceof Error ? e.message : String(e);
  if (signal?.aborted || name === "AbortError") return { kind: "aborted", message, backend };
  if (name === "TimeoutError") return { kind: "timeout", message, backend };
  return { kind: "network", message, backend };
}
