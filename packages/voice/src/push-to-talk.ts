// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// One push-to-talk session: buffers microphone audio while the key is down, runs fast partial transcripts
// for the live caption and local stop-word spotting, and on release trims silence (VAD) and transcribes
// the utterance with the final backend. Audio capture itself lives in the app (renderer/utility process).
import { err, ok, type Result } from "@ghosthand/protocol";
import { concatChunks, durationMs, type PcmChunk, STT_SAMPLE_RATE } from "./audio.ts";
import { type PttAction, type PttEvent, PttKeyMachine, type PttTiming } from "./ptt-keys.ts";
import { detectStopWord, type StopWordHit } from "./stop-words.ts";
import type { SpeechToText, SttError, SttResult } from "./stt.ts";
import { createEnergyVad, trimSilence, type VoiceActivityDetector } from "./vad.ts";

export type PttState = "idle" | "listening" | "transcribing";

export interface Utterance {
  text: string;
  stt: SttResult;
  /** Trimmed 16 kHz samples that were transcribed. */
  audio: Float32Array;
  /** Wall time the key went down and up (ms, session clock). */
  startedAt: number;
  endedAt: number;
  /** Set when a partial already matched stop/cancel. */
  stopWord?: StopWordHit;
}

export type UtteranceError =
  | SttError
  | { kind: "too_short"; message: string }
  | { kind: "silence"; message: string }
  | { kind: "not_listening"; message: string };

export interface PushToTalkOptions {
  /** Backend for the final transcript. */
  stt: SpeechToText;
  /** Fast (local) backend for partials and stop words; defaults to `stt` when it is local. */
  partialStt?: SpeechToText;
  /** New audio needed before the next partial, ms of audio (default 160). */
  partialStepMs?: number;
  /** Audio window sent for each partial, from the start of the utterance, ms (default 6000). */
  partialWindowMs?: number;
  /** Utterances shorter than this are discarded (default 250 ms). */
  minUtteranceMs?: number;
  vad?: () => VoiceActivityDetector;
  language?: string;
  /** Biasing terms for the final transcript (grammar verbs, visible element names). */
  keyterms?: () => string[];
  timing?: Partial<PttTiming>;
  clock?: () => number;
  onState?: (state: PttState) => void;
  onPartial?: (text: string) => void;
  /** Fired once per utterance, as soon as a partial opens with stop/cancel. */
  onStopWord?: (hit: StopWordHit, partial: string) => void;
}

export class PushToTalkSession {
  readonly #o: PushToTalkOptions;
  readonly #keys: PttKeyMachine;
  readonly #clock: () => number;
  #state: PttState = "idle";
  #chunks: PcmChunk[] = [];
  #samples = 0;
  #lastPartialAt = 0;
  #partialInFlight = false;
  #stopHit: StopWordHit | undefined;
  #startedAt = 0;
  #generation = 0;

  constructor(opts: PushToTalkOptions) {
    this.#o = opts;
    this.#keys = new PttKeyMachine(opts.timing);
    this.#clock = opts.clock ?? (() => performance.now());
  }

  get state(): PttState {
    return this.#state;
  }

  get bufferedMs(): number {
    return durationMs(this.#samples);
  }

  #set(state: PttState): void {
    this.#state = state;
    this.#o.onState?.(state);
  }

  start(): void {
    this.#generation++;
    this.#chunks = [];
    this.#samples = 0;
    this.#lastPartialAt = 0;
    this.#stopHit = undefined;
    this.#startedAt = this.#clock();
    this.#set("listening");
  }

  discard(): void {
    this.#generation++;
    this.#chunks = [];
    this.#samples = 0;
    this.#set("idle");
  }

  /** Microphone audio (any rate; resampled to 16 kHz). Ignored unless listening. */
  push(chunk: PcmChunk): void {
    if (this.#state !== "listening") return;
    const c =
      chunk.sampleRate === STT_SAMPLE_RATE
        ? chunk
        : { samples: concatChunks([chunk]), sampleRate: STT_SAMPLE_RATE };
    this.#chunks.push(c);
    this.#samples += c.samples.length;
    this.#maybePartial();
  }

  #partialBackend(): SpeechToText | undefined {
    if (this.#o.partialStt) return this.#o.partialStt;
    return this.#o.stt.capabilities.local ? this.#o.stt : undefined;
  }

  #maybePartial(): void {
    const backend = this.#partialBackend();
    if (!backend || this.#partialInFlight || this.#stopHit) return;
    const stepSamples = ((this.#o.partialStepMs ?? 160) * STT_SAMPLE_RATE) / 1000;
    if (this.#samples - this.#lastPartialAt < stepSamples) return;
    this.#lastPartialAt = this.#samples;
    this.#partialInFlight = true;
    const generation = this.#generation;
    const all = concatChunks(this.#chunks);
    const windowSamples = ((this.#o.partialWindowMs ?? 6000) * STT_SAMPLE_RATE) / 1000;
    // Stop words open the utterance, so the window starts at the beginning until it is full.
    const audio = all.length > windowSamples ? all.subarray(0, windowSamples) : all;
    void backend.transcribe(audio, this.#o.language ? { language: this.#o.language } : {}).then((r) => {
      this.#partialInFlight = false;
      if (generation !== this.#generation || !r.ok) return;
      this.#o.onPartial?.(r.value.text);
      const hit = detectStopWord(r.value.text);
      if (hit && !this.#stopHit) {
        this.#stopHit = hit;
        this.#o.onStopWord?.(hit, r.value.text);
        return;
      }
      if (this.#state === "listening") this.#maybePartial();
    });
  }

  /** Ends listening and transcribes the utterance. */
  async stop(signal?: AbortSignal): Promise<Result<Utterance, UtteranceError>> {
    if (this.#state !== "listening") return err({ kind: "not_listening", message: "not listening" });
    this.#generation++;
    const endedAt = this.#clock();
    const all = concatChunks(this.#chunks);
    this.#chunks = [];
    this.#samples = 0;
    if (durationMs(all.length) < (this.#o.minUtteranceMs ?? 250)) {
      this.#set("idle");
      return err({ kind: "too_short", message: `${Math.round(durationMs(all.length))} ms of audio` });
    }
    const trimmed = trimSilence(all, (this.#o.vad ?? (() => createEnergyVad()))());
    if (!trimmed) {
      this.#set("idle");
      return err({ kind: "silence", message: "no speech detected" });
    }
    this.#set("transcribing");
    const keyterms = this.#o.keyterms?.();
    const r = await this.#o.stt.transcribe(trimmed, {
      ...(this.#o.language ? { language: this.#o.language } : {}),
      ...(keyterms && keyterms.length > 0 ? { keyterms } : {}),
      ...(signal ? { signal } : {}),
    });
    this.#set("idle");
    if (!r.ok) return r;
    return ok({
      text: r.value.text,
      stt: r.value,
      audio: trimmed,
      startedAt: this.#startedAt,
      endedAt,
      ...(this.#stopHit ? { stopWord: this.#stopHit } : {}),
    });
  }

  /**
   * Feeds a hotkey event. Returns the key action; when it ends an utterance, `utterance` resolves with
   * the transcript (or why there is none).
   */
  key(e: PttEvent): { action: PttAction; utterance?: Promise<Result<Utterance, UtteranceError>> } {
    const action = this.#keys.feed(e);
    switch (action.type) {
      case "start":
        this.start();
        return { action };
      case "discard":
        this.discard();
        return { action };
      case "stop":
        return { action, utterance: this.stop() };
      default:
        return { action };
    }
  }
}
