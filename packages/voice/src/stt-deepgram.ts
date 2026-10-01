// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Deepgram pre-recorded transcription: POST /v1/listen with the WAV body. Nova-3 with keyterm prompting
// (up to 100 terms; 20-50 recommended). Key from DEEPGRAM_API_KEY in the engine env.
import { ok, type Result } from "@ghosthand/protocol";
import { z } from "zod";
import { type AudioInput, durationMs, encodeWav, toSamples } from "./audio.ts";
import type { SpeechToText, SttError, SttResult, SttSegment, TranscribeOptions } from "./stt.ts";
import { DEFAULT_STT_TIMEOUT_MS, type HostedSttOptions, notConfigured, requestJson } from "./stt-http.ts";

export const DEEPGRAM_BASE_URL = "https://api.deepgram.com/v1";
export const DEEPGRAM_MODEL = "nova-3";
export const DEEPGRAM_MAX_KEYTERMS = 50;

const Word = z.object({
  word: z.string(),
  punctuated_word: z.string().optional(),
  start: z.number(),
  end: z.number(),
  confidence: z.number().optional(),
});
const DeepgramResponse = z.object({
  metadata: z.object({ request_id: z.string().optional() }).optional(),
  results: z.object({
    channels: z.array(
      z.object({
        alternatives: z.array(
          z.object({
            transcript: z.string(),
            confidence: z.number().optional(),
            words: z.array(Word).optional(),
          }),
        ),
      }),
    ),
  }),
});

export function deepgramUrl(baseUrl: string, model: string, t: TranscribeOptions): string {
  const params = new URLSearchParams({ model, smart_format: "true", punctuate: "true" });
  if (t.language) params.set("language", t.language);
  const terms = [...new Set((t.keyterms ?? []).map((k) => k.trim()).filter(Boolean))].slice(
    0,
    DEEPGRAM_MAX_KEYTERMS,
  );
  for (const term of terms) params.append("keyterm", term);
  return `${baseUrl}/listen?${params.toString()}`;
}

export function createDeepgramStt(opts: HostedSttOptions): SpeechToText {
  const model = opts.model ?? DEEPGRAM_MODEL;
  const baseUrl = (opts.baseUrl ?? DEEPGRAM_BASE_URL).replace(/\/$/, "");
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  return {
    id: "deepgram",
    model,
    capabilities: {
      local: false,
      streaming: false,
      keyterms: true,
      languages: "multilingual",
      usdPerMinute: 0.0077,
    },
    async transcribe(audio: AudioInput, t: TranscribeOptions = {}): Promise<Result<SttResult, SttError>> {
      if (!opts.apiKey) return notConfigured("deepgram", "DEEPGRAM_API_KEY is not set");
      const samples = toSamples(audio);
      const started = performance.now();
      const r = await requestJson(
        "deepgram",
        doFetch,
        deepgramUrl(baseUrl, model, t),
        {
          method: "POST",
          headers: { Authorization: `Token ${opts.apiKey}`, "Content-Type": "audio/wav" },
          body: encodeWav(samples),
        },
        DeepgramResponse,
        { timeoutMs: opts.timeoutMs ?? DEFAULT_STT_TIMEOUT_MS, signal: t.signal },
      );
      if (!r.ok) return r;
      const alt = r.value.results.channels[0]?.alternatives[0];
      const segments: SttSegment[] = (alt?.words ?? []).map((w) => ({
        text: w.punctuated_word ?? w.word,
        startMs: w.start * 1000,
        endMs: w.end * 1000,
        ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
      }));
      return ok({
        text: (alt?.transcript ?? "").trim(),
        ...(segments.length > 0 ? { segments } : {}),
        latencyMs: performance.now() - started,
        model,
        backend: "deepgram",
        audioMs: durationMs(samples.length),
      });
    },
  };
}
