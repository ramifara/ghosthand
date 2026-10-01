<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# Voice probe: local STT on synthetic speech (Phase 4)

A one-time manual check of the local speech path in `@ghosthand/voice`: `sherpa-onnx-node` → Moonshine / Whisper → command grammar. Run on 2026-10-01 on the dev box: AMD Ryzen 5 3500U (4 cores, 8 threads), Node 26.4, `sherpa-onnx-node` 1.13.8 (onnxruntime 1.28.2), 2 threads per recognizer. No hosted STT was called.

## Setup

- **Native addon:** `sherpa-onnx-node` installs from npm with the prebuilt `sherpa-onnx-linux-x64` package (no compiler, no install script) and loads under Node 26.
- **Models:** downloaded with `ghosthand voice models download <id> --models-dir <dir>`. That exercises the real manager: pinned URLs, SHA-256 check, tar.bz2 extraction and manifest. `moonshine-tiny-en`, `moonshine-base-en`, `whisper-tiny-en` and `silero-vad` installed and passed `voice models verify`. One `silero-vad` download failed once on the network and succeeded on retry.
- **Real speech sanity check:** the `test_wavs/0.wav` that ships inside the Moonshine archive (3.8 s of human speech: "Ask not what your country can do for you…") came out word-perfect with Moonshine Tiny, Moonshine Base and Whisper Tiny (`ghosthand voice transcribe`). Moonshine Tiny takes about 150 ms warm on that clip.
- **Command clips:** `espeak-ng` is not installed. Instead, 32 command utterances were synthesized with sherpa-onnx's own TTS and two Piper voices (`en_US-amy-low-int8`, `en_US-ryan-low-int8`), giving 64 clips. Each clip gets 300 ms of silence on both sides, and a second copy gets white noise at about -30 dBFS. The clips are trimmed with the energy VAD and transcribed. "Parse match" means `parseUtterance(transcript)` gives the same command as `parseUtterance(reference)`, which is what matters for voice commands. Low-quality Piper voices are much harder than a real speaker: they garble short words such as "stop", "cancel" and "undo". Treat these numbers as a floor.

The utterances are: stop, cancel, go back, scroll down, scroll up a bit, scroll to the top, next page, reload the page, show numbers, hide numbers, click twelve, click number seven, click settings, click the save button, click the second invoice, open the last result, the other one, no the second one, that one, press enter, press escape, type hello world, fill email with alice at example dot com, check remember me, uncheck newsletter, select germany from the country dropdown, submit the form, undo, yes do it, go to example dot com, and two multi-step goals.

## Results

| Model | Audio | WER | Parse match | p50 latency | p95 latency | RTF |
|---|---|---|---|---|---|---|
| Moonshine v2 Tiny (int8, 30 MB) | clean | 15.4% | 43/64 | 61 ms | 125 ms | 0.05 |
| Moonshine v2 Tiny | noisy | 16.3% | 47/64 | 137 ms | 305 ms | 0.09 |
| Moonshine v2 Base (int8, 111 MB) | clean | 11.5% | 48/64 | 458 ms | 906 ms | 0.35 |
| Moonshine v2 Base | noisy | 24.0% | 47/64 | 449 ms | 795 ms | 0.27 |
| Whisper Tiny.en (int8, 104 MB) | clean | 15.4% | 52/64 | 562 ms | 1265 ms | 0.46 |
| Whisper Tiny.en | noisy | 15.4% | 49/64 | 569 ms | 1552 ms | 0.39 |

The mean clip is 1.4 s of trimmed audio (1.8 s noisy). Latency is warm decode time per utterance and excludes the one-time model load (about 0.5 s for Tiny).

**Stop word, real Moonshine Tiny partials streamed in 20 ms frames** (`PushToTalkSession`, five runs per voice):

| Measured from | amy "stop" (525 ms word) | ryan "stop" (278 ms word) |
|---|---|---|
| end of the word → `onStopWord` | 128-155 ms | never detected: the model heard "Soap" / "So" |
| start of the word → `onStopWord` | 673-702 ms | n/a |

The first implementation waited for the next 160 ms partial step. That took 655-880 ms from word onset, about 300 ms after the word ended. Adding a partial at each voiced-to-silent boundary brought end-of-word → abort down to about 140 ms. The engine side, `session.abort()` → in-flight `runVoiceCommand` resolves `aborted`, is tested at under 300 ms with a 3 s fake action. Together that meets the plan's "stop aborts < 300 ms" when it is measured from the end of the word. Measured from the start of the word it cannot: the word itself lasts 300-500 ms.

## Errors that matter

- **Short control words are fragile.** "stop" → "Soap"/"So"/"Start", "cancel" → "Tendul"/"10th", "undo" → "And you"/"I know", "that one" → "Ellen"/"Allen". The local Moonshine stop path misses one of the two synthetic voices completely. A dedicated keyword spotter (sherpa-onnx KWS, already in the addon) or hotword biasing should back up the grammar before "stop" is advertised as reliable. Hosted backends with keyterms (Deepgram) help with the final transcript, not with the local stop.
- **"no" heard as "now"** turns "no, the second one" (a correction) into "the second one" (a fresh click). The resolver still picks the right element; only the undo-first step is lost.
- **Repetition hallucinations** ("Next page next page next page…", "Click 12. Click 12.") in Moonshine Base and Whisper on noisy audio. The grammar now collapses a phrase repeated back to back.
- **Inflections and spelling:** "Opened the last result", "drop-down", "example.com" vs "example dot com". The grammar now normalizes past-tense opening verbs and "drop-down". These fixes came from this probe and have table tests.

## Recommendation

- Keep **Moonshine v2 Tiny** as the default for partials and the stop word: about 60 ms per utterance at 0.05 RTF on a 2019 laptop CPU. For the final transcript, use a hosted backend when a key is present (as the note recommends). Offline, use Moonshine Tiny, with Base as an opt-in. Base is 7x slower here for a small clean-audio gain and was worse on noise.
- Whisper Tiny parsed the most commands correctly (52/64) at 0.46 RTF. That is acceptable for push-to-talk finals of 1-2 s, and it covers other languages.
- Pending: a run with real recorded speech (several speakers and microphones), and a run of hosted backends (OpenAI `gpt-transcribe`, Deepgram `nova-3`) once keys are available. Both need the paid probe policy (scripts only, never CI). The probe script lived in `/tmp` and is not committed. It uses the same public APIs (`createModelManager`, `createLocalStt`, `trimSilence`, `PushToTalkSession`, `parseUtterance`) plus `sherpa.OfflineTts`.
