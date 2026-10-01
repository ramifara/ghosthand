# Voice-guided mode for GhostHand (research, 2026-10-01)

Scope: user speaks commands ("open settings", "click the second invoice", "go back", "stop"), the agent acts live, and the session is recorded so it can be replayed. Web research only. Nothing was installed and no API calls were made.

Legend: **[V]** verified from a primary source (vendor docs, repo, issue tracker). **[S]** secondary source (blogs, benchmark posts, press). **[U]** inferred or unverified.

---

## 1. Speech-to-text options

### 1a. Hosted streaming STT (Sept 2026)

| Option | Streaming | Price | Latency / notes | URL |
|---|---|---|---|---|
| OpenAI `gpt-realtime-whisper` (May 7 2026) / `gpt-live-transcribe` | yes (Realtime WS) | $0.017/min | dedicated streaming transcription | https://costgoat.com/pricing/openai-transcription [S], https://thenextweb.com/news/openai-gpt-realtime-2-voice-models [S] |
| OpenAI `gpt-transcribe` | files + "committed turns in Realtime sessions" (`v1/realtime/transcription_sessions`) | $0.0045/min | cheapest OpenAI model. Fits push-to-talk well because each PTT release is one committed turn | https://developers.openai.com/api/docs/models/gpt-transcribe [V] |
| OpenAI `gpt-4o-mini-transcribe` | file/turn | $0.003/min | cheap batch fallback | costgoat [S] |
| Deepgram Nova-3 / Flux | yes (WS) | ~$0.0077/min PAYG [U] | Nova-3 under 300 ms partials. Flux has built-in semantic end-of-turn (~260 ms median, p95 1.5 s). **Keyterm prompting** takes up to 100 terms (20-50 recommended) and works with Nova-3 and Flux | https://deepgram.com/learn/introducing-flux-conversational-speech-recognition [V], https://developers.deepgram.com/docs/measuring-streaming-latency [V], https://telnyx.com/release-notes/deepgram-keyterm-prompting-voice-ai-assistants [S] |
| AssemblyAI Universal-Streaming | yes | $0.15/hr (EN and 5-language multilingual) | cheapest hosted streaming option | https://www.assemblyai.com/pricing [V] |
| ElevenLabs Scribe v2 Realtime | yes | $0.39/hr | ~150 ms partials, 30 languages, keyterms +$0.05/hr | https://elevenlabs.io/realtime-speech-to-text [V] |
| Google Gemini 3.5 Transcribe (Live), released 2026-09-15 | yes | ~$0.0089/min blended | 4.0% WER streaming, **custom vocabulary biasing up to 1,000 terms**, 85+ languages | https://blog.google/innovation-and-ai/technology/developers-tools/build-real-time-voice-applications-gemini-audio/ [V], https://wavespeed.ai/blog/cost-and-billing/gemini-3-5-transcribe-pricing/ [S] |
| Gemini 3.8 Live / OpenAI gpt-realtime-2 (speech-to-speech) | yes | ~$0.005/min in (Gemini). gpt-realtime-mini costs $0.06-0.15/min in practice | Full voice-agent models with tool calls and barge-in. Too costly and slow to sit in the action loop; worth a look for a later "conversational" mode | blog.google above, https://hackernoon.com/openai-realtime-api-pricing-in-2026-real-world-data-from-4000-measured-sessions [S] |
| OpenRouter `/api/v1/audio/transcriptions` (launched 2026-07-22) | **no streaming** (request/response, base64 or multipart, 25 MB) | per-second or per-token | whisper-large-v3(-turbo), gpt-4o-transcribe, MAI-Transcribe 2, Nemotron 3.5 ASR streaming. Works as a PTT turn-based fallback with one OpenRouter key | https://openrouter.ai/docs/guides/overview/multimodal/stt [V], https://openrouter.ai/announcements/announcing-audio-apis [V] |

**ChatGPT plan / "Sign in with ChatGPT" (SIWC):** the docs exclude audio explicitly: *"Audio/video input, the Files upload API, and the transcription API are not supported by this flow."* Only the Responses API is covered; Realtime is not mentioned. https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations [V]. Codex itself dictates through the private `https://chatgpt.com/backend-api/transcribe` using the ChatGPT OAuth token (https://github.com/openai/codex/issues/20668 [V]). Some third-party apps reuse that endpoint (e.g. https://github.com/justingorczyca/Beeamvo/pull/3 [S]), but it is undocumented, private, and against the spirit of SIWC. **Do not depend on it.** A SIWC-only user therefore needs local STT.

### 1b. Local, CPU-friendly STT

| Engine | Fit for GhostHand | Numbers | URL |
|---|---|---|---|
| **Moonshine v2 (streaming)**, MIT | Best for short commands on weak CPUs. Encodes while the user is still speaking. Ships JS/WASM, Python, native bindings, plus an "intent recognition" feature | Tiny 34 ms / Small 73 ms / Medium 107 ms latency (MacBook Pro). Medium reportedly beats Whisper Large v3 WER with 6x fewer params | https://github.com/moonshine-ai/moonshine [V], https://arxiv.org/html/2602.12241v1 [V] |
| **sherpa-onnx** (`sherpa-onnx-node` N-API addon, prebuilt for linux x64/arm64, mac x64/arm64, win x64; Electron examples) | Best runtime for a single Node-side engine. Bundles Silero VAD, streaming zipformer, Parakeet, Moonshine, Whisper, **keyword spotting**, and **hotword biasing** | Parakeet-TDT-0.6B-v3 int8 runs ~30-40x realtime on x86 desktop CPU (~650 MB) | https://github.com/k2-fsa/sherpa-onnx [V], https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/README.md [V], https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx [S] |
| NVIDIA Parakeet-TDT-0.6B-v3 (offline, 25 EU langs) | High-accuracy "final pass" after PTT release. Fast enough on CPU, but the download is large | see above | https://openwhispr.com/blog/parakeet-vs-whisper-vs-nemotron [S] |
| NVIDIA Nemotron Speech Streaming 0.6B / Nemotron 3.5 ASR Streaming Multilingual (2026-08-13) | True cache-aware streaming. ONNX int8/int4 exports exist. CPU about 3.8x realtime, which is tight on low-end machines | | https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b [V], https://github.com/codavidgarcia/nemotron-3.5-asr-streaming-onnx [S] |
| whisper.cpp | Mature and cross-platform (CPU/Metal/Vulkan). Not streaming-native: `--stream` lags 0.5-2 s. Fine for PTT with base.en/small.en | small.en ~5% WER at 4-8x RT on CPU; base.en ~7% WER | https://www.promptquorum.com/power-local-llm/local-whisper-stt-comparison-2026 [S] |
| transformers.js v4 (WebGPU/WASM) in the renderer | Works (e.g. Moonshine Web, Whisper Web). GPU-dependent, and v4-next had ASR timestamp regressions. Prefer native sherpa-onnx on the main/utility process | | https://huggingface.co/posts/Xenova/486935205804807 [S], https://github.com/huggingface/transformers.js/issues/1590 [V] |

### 1c. Chromium Web Speech API in Electron: do not use
- Cloud `webkitSpeechRecognition` needs Google's private API key, which Electron does not ship, so it fails with a `network` error. https://github.com/electron/electron/issues/46143 [V], https://github.com/electron/electron/issues/7749 [V]. The 46143 issue is marked "fixed for next release" in 35/36, but the fix appears to be about the failure mode, not working recognition [U].
- On-device mode (`processLocally`, `SpeechRecognition.install()`) needs Chrome's SODA component, which comes through Chrome's component updater. Non-Chrome Chromium builds (e.g. Brave) report `install()` hanging on "downloading" with no SODA installed. https://github.com/brave/brave-browser/issues/55414 [V], https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally [V]. Expect the same in Electron [U].

### 1d. VAD, push-to-talk, always-on
- Silero VAD v6 ONNX is available in the browser through `@ricky0123/vad-web` (≥0.0.31 fixes the 64-sample context) and natively in sherpa-onnx. https://www.npmjs.com/package/@ricky0123/vad-web [V], https://github.com/Pedal-Intelligence/saypi-userscript/pull/661 [S]
- **Push-to-talk (global hotkey, hold or toggle)** removes false triggers, endpointing errors, and privacy concerns. Each utterance gets a clean start and end, which suits turn-based `gpt-transcribe`/OpenRouter. VAD is still useful inside PTT to trim silence.
- **Always-on** needs VAD + endpointing (Flux EOT or Silero + 500-700 ms hangover) plus a local keyword spotter for "stop"/"cancel" that works even while the agent speaks or acts. Options: sherpa-onnx KWS or openWakeWord custom models (https://picovoice.ai/blog/complete-guide-to-wake-word/ [S], https://github.com/jwill736/PC-assistant/pull/37 [S]).

---

## 2. From utterance to action (fast path vs LLM)

Three-tier pipeline. Each tier runs only when the previous one is not confident.

1. **Deterministic grammar (0-5 ms).** Regex/PEG over normalized text for closed commands: `stop|cancel|wait`, `go back|forward`, `scroll up|down [N]`, `reload`, `undo`, `yes|confirm|no`, `show numbers|hide numbers`, `click|press <N>` / `<N>`, `type <text>`, `next|previous page`, `new tab`, `close tab`. Number words map to digits ("twelve" to 12, "to/too" to 2 only in a numeric slot). Biasing the STT with these terms and the visible element labels (Deepgram keyterms, Gemini vocabulary, sherpa hotwords) cuts errors at the source.
2. **Jev typed decisions (~200 ms each).**
   - *Intent*: choose-one over a closed intent enum (≤255: CLICK, OPEN, FILL_FORM, NAVIGATE_BACK, SEARCH, SELECT_OPTION, SCROLL_TO, READ, ..., OTHER) with the utterance + current page title.
   - *Target*: choose-one over the element table (≤255 rows: id, role, accessible name, ordinal within role group, region, visible number badge). Include **ordinal and spatial columns** ("2nd invoice row", "top-right") so "the second invoice" resolves from the table without reasoning.
   - *Risk*: yes/no "is this action destructive/irreversible/sends data/spends money?" plus a score. Above threshold, ask for voice confirmation.
   - *Confidence*: score. If low, or the top-2 targets are close, show numbers on the top candidates and ask "which one?"
3. **Hosted LLM planner** for open-ended utterances ("fill the form with my test data", "find the latest unpaid invoice and download it"). It returns a short plan of steps that GhostHand then executes through Jev. It runs async while the overlay shows "planning...".

**Deixis and dialogue state.** Keep a `focus stack`: last-hovered or last-highlighted element, last-acted element, last-mentioned set (candidates shown). "This / that / it" resolves to the current highlight, else the last acted element. "That one" while numbers are shown means the one under the mouse cursor or the most recent highlight. "The second / next / the one below" is ordinal over the last-mentioned set, else over same-role siblings of focus. "The other one" means the alternate in a 2-candidate set, or the runner-up from the last Jev target choice (store top-k scores).
**Corrections.** "No, the other one" / "not that" / "undo": if the last action is reversible (navigation, focus, typing), revert it (history.back, clear field) and re-execute with the next-ranked candidate. Otherwise say what happened and offer options. Treat "no" during a pending confirmation as cancel.
**Barge-in / interrupt.** "Stop" must preempt everything. Detect it locally (grammar on streaming partials or KWS) on the *partial* transcript, without waiting for the final. Abort the in-flight Playwright action through AbortController, cancel planner requests, and duck/stop TTS. A new PTT press during execution also counts as an interrupt: pause the queue, then process the new command.
**Voice confirmation for risky actions.** Show a modal overlay with the target highlighted + summary ("Delete 3 invoices?") and say it briefly (optional TTS). Accept only "confirm"/"yes, do it"; ignore filler. Time out to cancel. For the highest risk tier, require the key or a click as well as voice, since STT can hallucinate "yes".

---

## 3. Prior art and UX patterns that work

- **Windows Voice Access**: "show numbers [here]" puts numbered badges on clickable items; "show grid" gives a 3x3 recursive numbered grid for anything without accessibility metadata. Also "click <name>" with disambiguation numbers when the name matches several items. https://support.microsoft.com/en-us/topic/voice-access-command-list-dac0f091-87ce-454d-8d57-bef38d3d8563 [V]
- **macOS Voice Control**: "show names / show numbers / show grid / show window grid", then "click 12" or "tap 12"; saying a grid number refines it into a finer grid. https://support.apple.com/guide/mac-help/use-voice-control-commands-mh40719/mac [V]
- **Talon + Rango**: browser extension draws short letter hints ("air whale" = `aw`) next to interactive elements, with verbs like click/hover/copy-link. Shows that persistent, short, stable hint labels beat re-numbering on every frame. https://github.com/david-tejada/rango [V]
- **Serenade** (voice coding): unmaintained upstream, community fork exists. Pattern: show alternatives on ambiguous parses and pick by number. https://github.com/serenadeai/serenade [V]
- **OpenAI Realtime agents demo / voice + computer-use apps**: speech-to-speech model with tool calls, plus a separate CUA model for the screen. Pattern: "silent listening mode", and keeping the voice loop separate from the action loop. https://github.com/openai/openai-realtime-agents [V], https://github.com/sambuild04/screen-voice-agent [S]
- **Codex voice**: realtime sessions require a paid ChatGPT plan; transcripts get misheard identifiers, so ask the user to clarify before acting. https://codex.danielvaughan.com/2026/03/31/codex-cli-realtime-sessions-voice-transcription/ [S]

**Patterns to copy:** numbered badges on demand plus automatically on ambiguity; a grid fallback for canvas/desktop; a live caption showing the partial transcript plus the parsed intent ("CLICK → 'Invoice #1042' (2)"); highlight the target ~300 ms before acting so the user can say "stop"; an undo-first correction model; a persistent status pill (listening / thinking / acting / waiting-confirm).

---

## 4. Session recording for replay

Use one monotonic clock (performance.timeOrigin + hrtime) for every stream.

Capture per session:
- **Audio**: raw PTT segments (Opus/WebM) with start/end timestamps. Optional, opt-in, retention-limited.
- **Transcript**: partials + finals with word timestamps, STT provider/model, confidence, and biasing terms used.
- **Parse**: grammar match or Jev intent (enum + score + top-k), slots, deixis resolution trace (what "that one" pointed to and why).
- **Observation**: URL, title, element table snapshot (id, role, name, ordinal, bbox, frame path), **element fingerprint** (role + accessible name + stable attrs [data-testid, name, aria-label, href pattern] + DOM path hash + nearby label text + bbox-relative position), screenshot thumb.
- **Decision**: Jev questions asked (prompt hash, options, choice, score, latency), planner calls (model, tokens, cost).
- **Action**: Playwright call (locator strategy chain, args), result, duration, post-action URL/DOM diff, any undo.
- **Video/DOM**: Playwright 1.59+ `page.screencast` (action annotations, chapters) or trace zip, and/or rrweb DOM recording for a lightweight scrubbable replay. https://qaskills.sh/blog/playwright-1-59-screencast-api-guide-2026 [S], https://github.com/dthinkr/playwright-demo-recorder [S]
- **Secrets**: redact typed values from password/OTP fields in the transcript, events, and screenshots (mask bboxes).

**Turning a session into a recipe:**
1. Collapse the event log into committed steps: drop undone/corrected attempts and keep the final successful action per user intent.
2. Each step = `{intent, target: fingerprint + natural-language description, value, precondition (url pattern/title), postcondition (url/element appears)}`.
3. **Parameterize**: literals that came from speech ("type John Smith", "search for March") become `${params}`. Ask Jev or the LLM to propose names ("customerName"). Values that came from "my test data" link to a named fixture. Ordinals ("second invoice") stay as an ordinal or become a param, depending on user choice.
4. **Replay**: resolve each target by fingerprint first (fast, deterministic), then fall back to a Jev target choice over the live element table using the stored description, then LLM. Verify postconditions, and pause for voice/click help on mismatch.
5. Keep the original transcript as step comments so the recipe stays readable ("user said: 'click the second invoice'").

---

## 5. Recommendation

### v1
- **Activation**: global push-to-talk hotkey (hold to talk, double-tap to toggle hands-free for one command). Silero VAD trims silence. No always-on in v1.
- **STT default** (auto-selected from available credentials):
  1. **Local `sherpa-onnx-node` + Moonshine streaming (Small; Tiny on weak CPUs)** in an Electron utility process. Works offline, for SIWC-only users, and at zero cost. Hotword biasing comes from the grammar plus visible element names.
  2. If an OpenAI key is present: `gpt-transcribe` per PTT turn through the Realtime transcription session ($0.0045/min) for accuracy, while the local Moonshine partials still drive the live caption and instant "stop".
  3. Other keys: Deepgram Nova-3 with keyterms (best biasing + latency), Gemini 3.5 Transcribe (1k-term vocabulary), AssemblyAI (cheapest), ElevenLabs Scribe v2 RT.
  4. OpenRouter key only: `/audio/transcriptions` turn-based (whisper-large-v3-turbo).
  5. Optional higher-accuracy local final pass: Parakeet-TDT-0.6B-v3 int8 (650 MB download, on demand).
  - Never use Web Speech in Electron. Never use the private ChatGPT transcribe endpoint.
- **Grammar** (closed set, about 40 verbs): navigation (back/forward/reload/open <site>/new tab/close tab), pointing (click/open/select <name|N|ordinal>, "show numbers", "hide numbers", "show grid", "<N>"), text (type/fill <field> with <value>, clear, submit, press enter/tab/escape), scrolling (scroll up/down/top/bottom, page down), control (stop, cancel, undo, wait, continue, yes/confirm, no, "the other one", "repeat"), meta (start/stop recording, "save as recipe <name>", "help"). Anything else goes to Jev intent, then the planner.
- **Overlay UX**: floating status pill + live caption + parsed-intent chip; numbered badges (Voice Access style, stable per page state) shown on "show numbers" or automatically when Jev target confidence is low or the top-2 are close; target highlight with a ~300 ms "about to click" pulse; a confirmation card for risky actions; a toast after each action ("Clicked 'Settings' — say 'undo' to revert").
- **Recording**: always on in voice mode (audio optional), as a JSONL event log + Playwright screencast/trace, plus "save as recipe" at the end.

### Later upgrades
- Always-on with local KWS ("GhostHand ..." wake word, plus "stop" anytime) using sherpa-onnx KWS or openWakeWord.
- Deepgram Flux / semantic end-of-turn for hands-free mode.
- Grid overlay + desktop (UIA/AX) element tables with the same numbering UX.
- Optional TTS feedback and a speech-to-speech "conversational" mode (gpt-realtime-2 / Gemini 3.8 Live) for clarifying dialogue, kept separate from the Jev action loop.
- Speaker gating (voiceprint) to ignore other voices; multilingual through Nemotron 3.5 / Parakeet v3.
- Learn per-user aliases ("my dashboard" → URL) from corrections, and expose recipes as voice macros ("run monthly invoices for March").
