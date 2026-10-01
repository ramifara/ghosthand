// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Hosted backends planned for Phase 4 but not wired yet. Each returns `not_configured` so the backend
// picker can list them and fall back. Endpoints are from research note voice-mode.md §1a.
//
// TODO(voice): implement these as turn-based REST calls, like stt-openai.ts / stt-deepgram.ts:
// - gemini: Gemini 3.5 Transcribe (GOOGLE_API_KEY); custom vocabulary up to 1,000 terms.
// - assemblyai: Universal-Streaming / pre-recorded upload (ASSEMBLYAI_API_KEY); cheapest hosted option.
// - elevenlabs: Scribe v2 (ELEVENLABS_API_KEY); keyterms as a paid add-on.
// - openrouter: POST /api/v1/audio/transcriptions (OPENROUTER_API_KEY); request/response only, no
//   streaming; models whisper-large-v3(-turbo), gpt-4o-transcribe, ...
import type { Result } from "@ghosthand/protocol";
import type { SpeechToText, SttBackendId, SttError, SttResult } from "./stt.ts";
import { notConfigured } from "./stt-http.ts";

export type StubBackendId = Extract<SttBackendId, "gemini" | "assemblyai" | "elevenlabs" | "openrouter">;

export const STUB_BACKENDS: Readonly<
  Record<StubBackendId, { model: string; envKey: string; usdPerMinute: number }>
> = {
  gemini: { model: "gemini-3.5-transcribe", envKey: "GOOGLE_API_KEY", usdPerMinute: 0.0089 },
  assemblyai: { model: "universal-streaming", envKey: "ASSEMBLYAI_API_KEY", usdPerMinute: 0.0025 },
  elevenlabs: { model: "scribe-v2", envKey: "ELEVENLABS_API_KEY", usdPerMinute: 0.0065 },
  openrouter: { model: "openai/whisper-large-v3-turbo", envKey: "OPENROUTER_API_KEY", usdPerMinute: 0 },
};

export function createStubStt(id: StubBackendId): SpeechToText {
  const info = STUB_BACKENDS[id];
  return {
    id,
    model: info.model,
    capabilities: {
      local: false,
      streaming: false,
      keyterms: id !== "openrouter",
      languages: "multilingual",
      usdPerMinute: info.usdPerMinute,
    },
    transcribe(): Promise<Result<SttResult, SttError>> {
      return Promise.resolve(
        notConfigured(id, `${id} speech-to-text is not implemented yet (planned; uses ${info.envKey})`),
      );
    },
  };
}
