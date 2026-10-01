// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Speech-to-text wiring: keys from the engine env (process env first, then the env file), models from
// the STT model manager. Hosted keys are registered as secrets so logs and run folders redact them.
import {
  createModelManager,
  createSpeechToText,
  type ModelManager,
  pickSpeechToText,
  type SpeechToText,
  STT_ENV_KEYS,
  type SttBackendId,
} from "@ghosthand/voice";
import { envValue } from "./env-file.ts";
import type { EngineRuntime } from "./runtime.ts";

export interface VoiceSttOptions {
  /** Defaults to `$XDG_DATA_HOME/ghosthand/models/stt`. */
  modelsDir?: string;
  /** Local model id (e.g. "whisper-base"). */
  modelId?: string;
  language?: string;
}

export function createVoiceModels(opts: { modelsDir?: string } = {}): ModelManager {
  return createModelManager(opts.modelsDir ? { root: opts.modelsDir } : {});
}

export function createVoiceStt(
  rt: EngineRuntime,
  backend: SttBackendId | "auto",
  opts: VoiceSttOptions = {},
): { ok: true; value: SpeechToText } | { ok: false; error: string } {
  const env = (name: string) => {
    const v = envValue(name, rt.envFile);
    if (v && Object.values(STT_ENV_KEYS).includes(name)) rt.secrets.register(name, v);
    return v;
  };
  const factory = {
    env,
    models: createVoiceModels(opts),
    ...(opts.modelId ? { modelId: opts.modelId } : {}),
    ...(opts.language ? { language: opts.language } : {}),
  };
  if (backend === "auto") {
    const picked = pickSpeechToText(factory);
    return picked.ok
      ? picked
      : {
          ok: false,
          error: `no speech-to-text backend is available:\n${picked.error.tried.map((t) => `  ${t.backend}: ${t.message}`).join("\n")}`,
        };
  }
  const r = createSpeechToText(backend, factory);
  return r.ok ? r : { ok: false, error: `${backend}: ${r.error.message}` };
}
