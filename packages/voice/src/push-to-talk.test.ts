// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { BLOCK, createFakeStt, speak } from "./__fixtures__/fake-stt.ts";
import { join, noise } from "./__fixtures__/synthetic-audio.ts";
import { type PcmChunk, STT_SAMPLE_RATE } from "./audio.ts";
import { PushToTalkSession } from "./push-to-talk.ts";
import type { StopWordHit } from "./stop-words.ts";

const CHUNK = 320; // 20 ms microphone frames
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Streams samples in 20 ms frames at real time; returns when done. */
async function stream(session: PushToTalkSession, samples: Float32Array, onFrame?: (at: number) => void) {
  for (let i = 0; i < samples.length; i += CHUNK) {
    const chunk: PcmChunk = { samples: samples.subarray(i, i + CHUNK), sampleRate: STT_SAMPLE_RATE };
    onFrame?.(i);
    session.push(chunk);
    await sleep(20);
  }
}

describe("PushToTalkSession", () => {
  it("transcribes a held utterance", async () => {
    const stt = createFakeStt();
    const partials: string[] = [];
    const s = new PushToTalkSession({ stt, onPartial: (t) => partials.push(t), partialStepMs: 100 });
    s.start();
    s.push({ samples: speak("click", "click", "settings", "settings"), sampleRate: STT_SAMPLE_RATE });
    const r = await s.stop();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe("click settings");
    expect(s.state).toBe("idle");
  });

  it("discards taps and silence", async () => {
    const stt = createFakeStt();
    const s = new PushToTalkSession({ stt });
    s.start();
    s.push({ samples: new Float32Array(1000), sampleRate: STT_SAMPLE_RATE });
    expect((await s.stop()).ok).toBe(false);
    s.start();
    s.push({ samples: noise(800, 0.002), sampleRate: STT_SAMPLE_RATE });
    const r = await s.stop();
    expect(r.ok ? "ok" : r.error.kind).toBe("silence");
  });

  it("resamples 48 kHz microphone audio", async () => {
    const stt = createFakeStt();
    const s = new PushToTalkSession({ stt });
    s.start();
    const at48 = new Float32Array(48_000).fill(0.3); // 1 s of "click"
    s.push({ samples: at48, sampleRate: 48_000 });
    expect(Math.round(s.bufferedMs)).toBe(1000);
    const r = await s.stop();
    expect(r.ok && r.value.text).toBe("click");
  });

  it("drives start/stop from hotkey events", async () => {
    const stt = createFakeStt();
    const s = new PushToTalkSession({ stt });
    expect(s.key({ type: "down", at: 0 }).action.type).toBe("start");
    s.push({ samples: speak("click", "click", "settings", "settings"), sampleRate: STT_SAMPLE_RATE });
    const up = s.key({ type: "up", at: 900 });
    expect(up.action.type).toBe("stop");
    const r = await up.utterance;
    expect(r?.ok && r.value.text).toBe("click settings");
  });

  it(`"stop" on a partial fires in under 300 ms`, async () => {
    // A fake local STT taking 60 ms per partial, like Moonshine Tiny on a slow CPU.
    const stt = createFakeStt({ latencyMs: 60 });
    let hit: { at: number; hit: StopWordHit } | undefined;
    const controller = new AbortController();
    const s = new PushToTalkSession({
      stt,
      partialStepMs: 100,
      onStopWord: (h) => {
        hit = { at: performance.now(), hit: h };
        controller.abort();
      },
    });
    s.start();
    // 200 ms of silence, then the word "stop" (300 ms), then more silence.
    const audio = join(
      new Float32Array(BLOCK * 2),
      speak("stop", "stop", "stop"),
      new Float32Array(BLOCK * 3),
    );
    const stopStartsAt = BLOCK * 2;
    let spokenAt = 0;
    await stream(s, audio, (i) => {
      if (i <= stopStartsAt && stopStartsAt < i + CHUNK) spokenAt = performance.now();
    });
    expect(hit?.hit.kind).toBe("stop");
    expect(controller.signal.aborted).toBe(true);
    // From the first frame of "stop" reaching the session to the abort: the word must be audible in a
    // partial (one 100 ms block) and the partial must finish (60 ms), plus scheduling slack.
    const latency = (hit?.at ?? Number.POSITIVE_INFINITY) - spokenAt;
    expect(latency).toBeLessThan(300);
    // Reported for the probe doc when run with --reporter verbose.
    console.info(`stop-word latency: ${latency.toFixed(0)} ms`);
    const r = await s.stop();
    expect(r.ok && r.value.stopWord?.kind).toBe("stop");
  });

  it("no partials when the final backend is hosted and no partial backend is given", async () => {
    const stt = createFakeStt({ local: false });
    const partials: string[] = [];
    const s = new PushToTalkSession({ stt, onPartial: (t) => partials.push(t), partialStepMs: 20 });
    s.start();
    s.push({ samples: speak("click", "settings", "click"), sampleRate: STT_SAMPLE_RATE });
    await sleep(30);
    expect(partials).toEqual([]);
    expect(stt.calls).toBe(0);
  });
});
