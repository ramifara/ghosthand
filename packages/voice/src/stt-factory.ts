// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Builds a SpeechToText for a backend id, and picks the default backend from what is available
// (research note voice-mode.md §5: local Moonshine first, then hosted keys).
import { err, ok, type Result } from "@ghosthand/protocol";
import { defaultModelId } from "./model-catalog.ts";
import type { ModelManager } from "./model-manager.ts";
import { loadSherpa, type SherpaLoader } from "./sherpa.ts";
import type { SpeechToText, SttBackendId, SttError } from "./stt.ts";
import { createDeepgramStt } from "./stt-deepgram.ts";
import type { FetchLike } from "./stt-http.ts";
import { createLocalStt } from "./stt-local.ts";
import { createOpenAiStt } from "./stt-openai.ts";
import { createStubStt } from "./stt-stubs.ts";

/** Env-file keys the hosted backends read. */
export const STT_ENV_KEYS: Readonly<Record<"openai" | "deepgram", string>> = {
  openai: "OPENAI_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
};

export interface SttFactoryOptions {
  /** Reads a key from the engine env (process env first, then the env file). */
  env: (name: string) => string | undefined;
  models: ModelManager;
  /** Model id for local backends; defaults to the catalog default for the engine. */
  modelId?: string;
  language?: string;
  loader?: SherpaLoader;
  fetch?: FetchLike;
}

export function createSpeechToText(
  backend: SttBackendId,
  opts: SttFactoryOptions,
): Result<SpeechToText, SttError> {
  switch (backend) {
    case "moonshine":
    case "whisper": {
      const sherpa = (opts.loader ?? loadSherpa)();
      if (!sherpa.ok) return err({ kind: "unavailable", message: sherpa.error.message, backend });
      const id = opts.modelId ?? defaultModelId(backend);
      if (!id) return err({ kind: "unavailable", message: `no ${backend} model in the catalog`, backend });
      const model = opts.models.resolve(id);
      if (!model.ok) return err({ kind: "unavailable", message: model.error.message, backend });
      if (model.value.engine !== backend)
        return err({ kind: "unavailable", message: `model ${id} is a ${model.value.engine} model`, backend });
      return ok(
        createLocalStt({
          model: model.value,
          ...(opts.loader ? { loader: opts.loader } : {}),
          ...(opts.language ? { language: opts.language } : {}),
        }),
      );
    }
    case "openai":
    case "deepgram": {
      const apiKey = opts.env(STT_ENV_KEYS[backend]);
      if (!apiKey)
        return err({ kind: "not_configured", message: `${STT_ENV_KEYS[backend]} is not set`, backend });
      const hosted = { apiKey, ...(opts.fetch ? { fetch: opts.fetch } : {}) };
      return ok(backend === "openai" ? createOpenAiStt(hosted) : createDeepgramStt(hosted));
    }
    default:
      return ok(createStubStt(backend));
  }
}

/** Order the backend picker tries when the user has not chosen one. */
export const DEFAULT_BACKEND_ORDER: readonly SttBackendId[] = ["moonshine", "openai", "deepgram", "whisper"];

/** First backend that can be created right now, with the reasons the others were skipped. */
export function pickSpeechToText(
  opts: SttFactoryOptions,
  order: readonly SttBackendId[] = DEFAULT_BACKEND_ORDER,
): Result<SpeechToText, { kind: "none_available"; tried: SttError[] }> {
  const tried: SttError[] = [];
  for (const backend of order) {
    const r = createSpeechToText(backend, opts);
    if (r.ok) return r;
    tried.push(r.error);
  }
  return err({ kind: "none_available", tried });
}
