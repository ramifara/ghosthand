// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Local STT through sherpa-onnx: Moonshine (v2 merged decoder, or v1 four-file layout) and Whisper.
// Model files come from the model manager; nothing is bundled.
import { err, ok, type Result } from "@ghosthand/protocol";
import { type AudioInput, durationMs, STT_SAMPLE_RATE, toSamples } from "./audio.ts";
import type { InstalledModel } from "./model-manager.ts";
import { loadSherpa, type SherpaLoader, type SherpaOfflineRecognizer } from "./sherpa.ts";
import type {
  SpeechToText,
  SttBackendId,
  SttCapabilities,
  SttError,
  SttResult,
  TranscribeOptions,
} from "./stt.ts";

export interface LocalSttOptions {
  model: InstalledModel;
  /** CPU threads for onnxruntime (default 2). */
  numThreads?: number;
  /** Whisper only: language for multilingual models ("" = auto-detect). */
  language?: string;
  loader?: SherpaLoader;
}

const need = (model: InstalledModel, role: string): string | undefined => model.files[role];

/** Builds the OfflineRecognizer config for a model folder; undefined when files are missing. */
export function sherpaRecognizerConfig(
  model: InstalledModel,
  numThreads: number,
  language: string,
): Record<string, unknown> | undefined {
  const tokens = need(model, "tokens");
  const encoder = need(model, "encoder");
  if (!tokens || !encoder) return undefined;
  const common = { tokens, numThreads, debug: 0, provider: "cpu" };
  const featConfig = { sampleRate: STT_SAMPLE_RATE, featureDim: 80 };
  if (model.engine === "moonshine") {
    const merged = need(model, "mergedDecoder");
    const moonshine = merged
      ? { encoder, mergedDecoder: merged }
      : {
          preprocessor: need(model, "preprocessor"),
          encoder,
          uncachedDecoder: need(model, "uncachedDecoder"),
          cachedDecoder: need(model, "cachedDecoder"),
        };
    if (!merged && Object.values(moonshine).some((v) => v === undefined)) return undefined;
    return { featConfig, modelConfig: { ...common, moonshine } };
  }
  if (model.engine === "whisper") {
    const decoder = need(model, "decoder");
    if (!decoder) return undefined;
    return {
      featConfig,
      modelConfig: { ...common, whisper: { encoder, decoder, language, task: "transcribe" } },
    };
  }
  return undefined;
}

export function createLocalStt(opts: LocalSttOptions): SpeechToText {
  const backend: SttBackendId = opts.model.engine === "whisper" ? "whisper" : "moonshine";
  const loader = opts.loader ?? loadSherpa;
  const numThreads = opts.numThreads ?? 2;
  const englishOnly = backend === "moonshine" || /-en$/.test(opts.model.id);
  const capabilities: SttCapabilities = {
    local: true,
    streaming: false,
    keyterms: false,
    languages: englishOnly ? ["en"] : "multilingual",
    usdPerMinute: 0,
  };
  // One recognizer per language (only multilingual Whisper uses more than one).
  const recognizers = new Map<string, Promise<Result<SherpaOfflineRecognizer, SttError>>>();
  const fail = (kind: SttError["kind"], message: string) => err<SttError>({ kind, message, backend });

  function recognizer(language: string): Promise<Result<SherpaOfflineRecognizer, SttError>> {
    const key = englishOnly ? "en" : language;
    let pending = recognizers.get(key);
    if (!pending) {
      pending = (async () => {
        const sherpa = loader();
        if (!sherpa.ok) return fail("unavailable", sherpa.error.message);
        const config = sherpaRecognizerConfig(opts.model, numThreads, englishOnly ? "en" : key);
        if (!config) return fail("unavailable", `model ${opts.model.id} is missing files for ${backend}`);
        try {
          return ok(await sherpa.value.OfflineRecognizer.createAsync(config));
        } catch (e) {
          return fail(
            "unavailable",
            `cannot load ${opts.model.id}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      })();
      recognizers.set(key, pending);
    }
    return pending;
  }

  return {
    id: backend,
    model: opts.model.id,
    capabilities,
    async transcribe(audio: AudioInput, t: TranscribeOptions = {}): Promise<Result<SttResult, SttError>> {
      if (t.signal?.aborted) return fail("aborted", "aborted before start");
      const samples = toSamples(audio);
      const rec = await recognizer(t.language ?? opts.language ?? "");
      if (!rec.ok) return rec;
      const started = performance.now();
      try {
        const stream = rec.value.createStream();
        stream.acceptWaveform({ samples, sampleRate: STT_SAMPLE_RATE });
        const result = await rec.value.decodeAsync(stream);
        if (t.signal?.aborted) return fail("aborted", "aborted during decode");
        return ok({
          text: result.text.trim(),
          latencyMs: performance.now() - started,
          model: opts.model.id,
          backend,
          audioMs: durationMs(samples.length),
        });
      } catch (e) {
        return fail("provider", e instanceof Error ? e.message : String(e));
      }
    },
  };
}
