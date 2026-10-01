// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// OpenAI transcription: one PTT turn per POST /v1/audio/transcriptions (multipart). Default model
// `gpt-transcribe` ($0.0045/min, research note voice-mode.md §1a). Keys come from the engine env
// (OPENAI_API_KEY); the ChatGPT-plan login does not cover audio.
import { ok, type Result } from "@ghosthand/protocol";
import { z } from "zod";
import { type AudioInput, durationMs, encodeWav, toSamples } from "./audio.ts";
import type { SpeechToText, SttError, SttResult, TranscribeOptions } from "./stt.ts";
import { DEFAULT_STT_TIMEOUT_MS, type HostedSttOptions, notConfigured, requestJson } from "./stt-http.ts";

export const OPENAI_STT_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_STT_MODEL = "gpt-transcribe";

const OpenAiTranscription = z.object({ text: z.string() });

/** The prompt carries biasing terms (verbs and visible element names), capped to stay short. */
export function openAiPrompt(keyterms: readonly string[] | undefined): string | undefined {
  if (!keyterms || keyterms.length === 0) return undefined;
  const terms = [...new Set(keyterms.map((k) => k.trim()).filter(Boolean))].slice(0, 60);
  return `Voice commands for a web page. Vocabulary: ${terms.join(", ")}.`;
}

export function createOpenAiStt(opts: HostedSttOptions): SpeechToText {
  const model = opts.model ?? OPENAI_STT_MODEL;
  const baseUrl = (opts.baseUrl ?? OPENAI_STT_BASE_URL).replace(/\/$/, "");
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  return {
    id: "openai",
    model,
    capabilities: {
      local: false,
      streaming: false,
      keyterms: true,
      languages: "multilingual",
      usdPerMinute: 0.0045,
    },
    async transcribe(audio: AudioInput, t: TranscribeOptions = {}): Promise<Result<SttResult, SttError>> {
      if (!opts.apiKey) return notConfigured("openai", "OPENAI_API_KEY is not set");
      const samples = toSamples(audio);
      const form = new FormData();
      form.append("file", new Blob([encodeWav(samples)], { type: "audio/wav" }), "utterance.wav");
      form.append("model", model);
      form.append("response_format", "json");
      if (t.language) form.append("language", t.language);
      const prompt = openAiPrompt(t.keyterms);
      if (prompt) form.append("prompt", prompt);
      const started = performance.now();
      const r = await requestJson(
        "openai",
        doFetch,
        `${baseUrl}/audio/transcriptions`,
        { method: "POST", headers: { Authorization: `Bearer ${opts.apiKey}` }, body: form },
        OpenAiTranscription,
        { timeoutMs: opts.timeoutMs ?? DEFAULT_STT_TIMEOUT_MS, signal: t.signal },
      );
      if (!r.ok) return r;
      return ok({
        text: r.value.text.trim(),
        latencyMs: performance.now() - started,
        model,
        backend: "openai",
        audioMs: durationMs(samples.length),
      });
    },
  };
}
