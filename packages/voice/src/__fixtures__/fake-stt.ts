// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A fake local STT for tests. It "hears" words encoded as tone frequencies: each 100 ms block whose
// dominant amplitude matches a marker becomes a word. Latency is simulated with a timer.
import { ok, type Result } from "@ghosthand/protocol";
import { type AudioInput, durationMs, toSamples } from "../audio.ts";
import type { SpeechToText, SttError, SttResult } from "../stt.ts";

/** Constant-amplitude blocks: amplitude → word. */
export const WORD_LEVELS: Readonly<Record<string, number>> = { stop: 0.5, click: 0.3, settings: 0.2 };
export const BLOCK = 1600; // 100 ms at 16 kHz

export function speak(...ws: string[]): Float32Array {
  const out = new Float32Array(ws.length * BLOCK);
  ws.forEach((w, i) => {
    out.fill(WORD_LEVELS[w] ?? 0, i * BLOCK, (i + 1) * BLOCK);
  });
  return out;
}

export interface FakeStt extends SpeechToText {
  calls: number;
}

export function createFakeStt(opts: { latencyMs?: number; local?: boolean } = {}): FakeStt {
  const fake: FakeStt = {
    id: "moonshine",
    model: "fake-moonshine",
    calls: 0,
    capabilities: {
      local: opts.local ?? true,
      streaming: false,
      keyterms: false,
      languages: ["en"],
      usdPerMinute: 0,
    },
    async transcribe(audio: AudioInput): Promise<Result<SttResult, SttError>> {
      fake.calls++;
      const samples = toSamples(audio);
      const started = performance.now();
      const words: string[] = [];
      for (let i = 0; i + BLOCK <= samples.length; i += BLOCK) {
        const v = Math.abs(samples[i + BLOCK / 2] ?? 0);
        const w = Object.entries(WORD_LEVELS).find(([, level]) => Math.abs(level - v) < 0.01)?.[0];
        if (w && words[words.length - 1] !== w) words.push(w);
      }
      if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
      return ok({
        text: words.join(" "),
        latencyMs: performance.now() - started,
        model: fake.model,
        backend: fake.id,
        audioMs: durationMs(samples.length),
      });
    },
  };
  return fake;
}
