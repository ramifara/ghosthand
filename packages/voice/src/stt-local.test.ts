// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { createModelManager, type InstalledModel } from "./model-manager.ts";
import type { SherpaModule, SherpaOfflineStream } from "./sherpa.ts";
import { createSpeechToText, pickSpeechToText } from "./stt-factory.ts";
import { createLocalStt, sherpaRecognizerConfig } from "./stt-local.ts";

const moonshine: InstalledModel = {
  id: "moonshine-tiny-en",
  engine: "moonshine",
  dir: "/m",
  files: {
    encoder: "/m/encoder_model.ort",
    mergedDecoder: "/m/decoder_model_merged.ort",
    tokens: "/m/tokens.txt",
  },
};
const whisper: InstalledModel = {
  id: "whisper-base",
  engine: "whisper",
  dir: "/w",
  files: { encoder: "/w/e.onnx", decoder: "/w/d.onnx", tokens: "/w/t.txt" },
};

function fakeSherpa(text = "click settings") {
  const configs: unknown[] = [];
  const waves: number[] = [];
  const mod = {
    OfflineRecognizer: {
      createAsync: async (config: unknown) => {
        configs.push(config);
        return {
          createStream: (): SherpaOfflineStream => ({ acceptWaveform: (w) => waves.push(w.samples.length) }),
          decodeAsync: async () => ({ text: ` ${text} ` }),
        };
      },
    },
    Vad: function Vad() {},
    version: "1.13.8",
  } as unknown as SherpaModule;
  return { mod, configs, waves };
}

describe("local STT (sherpa-onnx)", () => {
  it("builds the Moonshine v2 and Whisper configs", () => {
    expect(sherpaRecognizerConfig(moonshine, 2, "en")).toEqual({
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: {
        tokens: "/m/tokens.txt",
        numThreads: 2,
        debug: 0,
        provider: "cpu",
        moonshine: { encoder: "/m/encoder_model.ort", mergedDecoder: "/m/decoder_model_merged.ort" },
      },
    });
    const w = sherpaRecognizerConfig(whisper, 1, "de") as { modelConfig: { whisper: unknown } };
    expect(w.modelConfig.whisper).toEqual({
      encoder: "/w/e.onnx",
      decoder: "/w/d.onnx",
      language: "de",
      task: "transcribe",
    });
    expect(sherpaRecognizerConfig({ ...moonshine, files: { tokens: "/t" } }, 1, "en")).toBeUndefined();
  });

  it("transcribes through the addon and caches the recognizer", async () => {
    const f = fakeSherpa();
    const stt = createLocalStt({ model: moonshine, loader: () => ok(f.mod) });
    const a = await stt.transcribe(new Float32Array(8000));
    const b = await stt.transcribe([{ samples: new Float32Array(4800), sampleRate: 48_000 }]);
    expect(a.ok && a.value).toMatchObject({
      text: "click settings",
      backend: "moonshine",
      model: "moonshine-tiny-en",
      audioMs: 500,
    });
    expect(b.ok && b.value.audioMs).toBe(100);
    expect(f.configs).toHaveLength(1);
    expect(f.waves).toEqual([8000, 1600]);
    expect(stt.capabilities).toMatchObject({ local: true, usdPerMinute: 0, languages: ["en"] });
  });

  it("creates one Whisper recognizer per language for multilingual models", async () => {
    const f = fakeSherpa();
    const stt = createLocalStt({ model: whisper, loader: () => ok(f.mod) });
    await stt.transcribe(new Float32Array(100), { language: "de" });
    await stt.transcribe(new Float32Array(100), { language: "fr" });
    await stt.transcribe(new Float32Array(100), { language: "de" });
    expect(f.configs).toHaveLength(2);
    expect(stt.capabilities.languages).toBe("multilingual");
  });

  it("reports unavailable when the addon cannot load", async () => {
    const stt = createLocalStt({
      model: moonshine,
      loader: () => err({ kind: "unavailable", message: "no addon" }),
    });
    const r = await stt.transcribe(new Float32Array(100));
    expect(r.ok ? "ok" : r.error).toEqual({ kind: "unavailable", message: "no addon", backend: "moonshine" });
  });
});

describe("STT factory", () => {
  const models = createModelManager({ root: mkdtempSync(join(tmpdir(), "gh-stt-")) });

  it("local backends need the addon and an installed model", () => {
    const noAddon = createSpeechToText("moonshine", {
      env: () => undefined,
      models,
      loader: () => err({ kind: "unavailable", message: "no addon" }),
    });
    expect(noAddon.ok ? "ok" : noAddon.error.kind).toBe("unavailable");
    const noModel = createSpeechToText("moonshine", {
      env: () => undefined,
      models,
      loader: () => ok(fakeSherpa().mod),
    });
    expect(noModel.ok ? "ok" : noModel.error.message).toContain("not installed");
  });

  it("hosted backends need their key", () => {
    const none = createSpeechToText("deepgram", { env: () => undefined, models });
    expect(none.ok ? "ok" : none.error.kind).toBe("not_configured");
    const dg = createSpeechToText("deepgram", {
      env: (k) => (k === "DEEPGRAM_API_KEY" ? "x" : undefined),
      models,
    });
    expect(dg.ok && dg.value.id).toBe("deepgram");
  });

  it("picks the first available backend and explains the rest", () => {
    const picked = pickSpeechToText({
      env: (k) => (k === "OPENAI_API_KEY" ? "sk" : undefined),
      models,
      loader: () => err({ kind: "unavailable", message: "no addon" }),
    });
    expect(picked.ok && picked.value.id).toBe("openai");
    const none = pickSpeechToText({
      env: () => undefined,
      models,
      loader: () => err({ kind: "unavailable", message: "x" }),
    });
    expect(none.ok ? "ok" : none.error.tried.map((t) => t.backend)).toEqual([
      "moonshine",
      "openai",
      "deepgram",
      "whisper",
    ]);
  });
});
