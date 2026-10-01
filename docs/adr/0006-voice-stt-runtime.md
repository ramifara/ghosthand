<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0006. Voice: local STT runtime, model sources and command recording

- Status: proposed
- Date: 2026-10-01

## Context
Phase 4 (plan §2 "Speech", §7) picks Moonshine through `sherpa-onnx-node` as the default local STT, downloadable Whisper models for other languages, and hosted STT through keys. Research note `voice-mode.md` covers the options. Building `packages/voice` raised a few questions the plan leaves open.

## Decision
- **Native addon is optional.** `sherpa-onnx-node` 1.13.8 (Apache-2.0, prebuilt for linux/mac/win x64 and arm64, no install script) is an `optionalDependency` of `@ghosthand/voice`. It is loaded with `createRequire` at runtime. When it is missing or fails to load, local STT and Silero VAD return `unavailable`, and the pure-TS energy VAD and hosted backends keep working. No `trustedDependencies` entry is needed.
- **Moonshine v2, English only.** The default is `moonshine-tiny-en` (Moonshine v2 "quantized" export from the sherpa-onnx `asr-models` release, 29.9 MB, MIT). Moonshine's non-English models use the non-commercial Moonshine Community License (stated in the archive's LICENSE), so the catalog does not list them. Other languages use Whisper (MIT) instead, which matches the plan.
- **Pinned downloads.** The catalog pins GitHub release assets (whose SHA-256 GitHub publishes) and Hugging Face files at a fixed commit. Each file carries a SHA-256. Archives (`.tar.bz2`) are extracted with the system `tar`, and a manifest of hashes is written for `verify`.
- **Partials without a streaming model.** sherpa-onnx's Moonshine is an offline recognizer, so push-to-talk re-runs it on the audio so far. It runs every 160 ms of new audio, and at once when voiced audio stops (a word boundary). That is what keeps "stop" fast (see `docs/research/voice-probe.md`). True streaming (Moonshine streaming or sherpa KWS) can replace it later behind the same session API.
- **Recording without new event types.** A voice session is one run folder. Each command adds a `model.call` (role `speech`, model `backend:model`, latency, cost), a `human` event (kind `input`, `voice: "<transcript>" → <parsed command>`) and, for single commands, `action`/`effect` events in router mode `H`. So `ghosthand replay` and export work unchanged. Multi-step goals run through `runTask` inside the same folder, with step numbers shifted and the inner `run.end` withheld. Audio is written to `audio/utt-NNN.wav` only when `recordAudio` is set. `VoiceCommand` was added to `protocol` (additive) for the overlay's intent chip.
- **Hosted backends.** OpenAI (`gpt-transcribe`, `POST /v1/audio/transcriptions`) and Deepgram (`nova-3`, `POST /v1/listen` with `keyterm`) are implemented. Gemini, AssemblyAI, ElevenLabs and OpenRouter are typed stubs that return `not_configured`.

## Consequences
- CI installs a ~33 MB platform package. It never downloads models: tests use fakes and a local HTTP server.
- A user with no local addon and no STT key gets `none_available`, with one reason per backend.
- Voice confirmation of risky actions comes from core `combineEffect`. `forbidden` is flagged `manual` so the UI can require a key press or click as well.
