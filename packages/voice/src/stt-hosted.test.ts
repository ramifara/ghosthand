// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { decodeWav } from "./audio.ts";
import { createDeepgramStt, deepgramUrl } from "./stt-deepgram.ts";
import type { FetchLike } from "./stt-http.ts";
import { createOpenAiStt, OPENAI_STT_MODEL } from "./stt-openai.ts";
import { createStubStt, STUB_BACKENDS, type StubBackendId } from "./stt-stubs.ts";

interface Captured {
  url: string;
  init: RequestInit | undefined;
}

function mockFetch(status: number, body: unknown): { fetch: FetchLike; calls: Captured[] } {
  const calls: Captured[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    },
  };
}

const audio = new Float32Array(16_000).fill(0.1);

describe("OpenAI STT", () => {
  it("posts multipart with model, language, prompt and the WAV file", async () => {
    const m = mockFetch(200, { text: " Click settings. " });
    const stt = createOpenAiStt({ apiKey: "sk-test", fetch: m.fetch });
    const r = await stt.transcribe(audio, { language: "en", keyterms: ["click", "Settings", "click"] });
    expect(r.ok && r.value).toMatchObject({
      text: "Click settings.",
      model: OPENAI_STT_MODEL,
      backend: "openai",
      audioMs: 1000,
    });
    const call = m.calls[0];
    expect(call?.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(call?.init?.method).toBe("POST");
    expect(new Headers(call?.init?.headers).get("authorization")).toBe("Bearer sk-test");
    const form = call?.init?.body as FormData;
    expect(form.get("model")).toBe("gpt-transcribe");
    expect(form.get("language")).toBe("en");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("prompt")).toBe("Voice commands for a web page. Vocabulary: click, Settings.");
    const file = form.get("file") as File;
    expect(file.name).toBe("utterance.wav");
    expect(file.type).toBe("audio/wav");
    const wav = decodeWav(new Uint8Array(await file.arrayBuffer()));
    expect(wav.ok && wav.value.samples.length).toBe(16_000);
  });

  it("maps errors without throwing", async () => {
    const cases: Array<[number, string]> = [
      [401, "auth"],
      [429, "rate_limit"],
      [400, "invalid_audio"],
      [503, "server"],
    ];
    for (const [status, kind] of cases) {
      const stt = createOpenAiStt({
        apiKey: "k",
        fetch: mockFetch(status, { error: { message: "x" } }).fetch,
      });
      const r = await stt.transcribe(audio);
      expect(r.ok ? "ok" : [r.error.kind, r.error.status]).toEqual([kind, status]);
    }
    const missing = await createOpenAiStt({ apiKey: undefined }).transcribe(audio);
    expect(missing.ok ? "ok" : missing.error.kind).toBe("not_configured");
    const bad = await createOpenAiStt({ apiKey: "k", fetch: mockFetch(200, { nope: 1 }).fetch }).transcribe(
      audio,
    );
    expect(bad.ok ? "ok" : bad.error.kind).toBe("provider");
  });

  it("honours abort and timeout", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const controller = new AbortController();
    const p = createOpenAiStt({ apiKey: "k", fetch: hang }).transcribe(audio, { signal: controller.signal });
    controller.abort();
    const aborted = await p;
    expect(aborted.ok ? "ok" : aborted.error.kind).toBe("aborted");
    const timed = await createOpenAiStt({ apiKey: "k", fetch: hang, timeoutMs: 20 }).transcribe(audio);
    expect(timed.ok ? "ok" : timed.error.kind).toBe("timeout");
  });
});

describe("Deepgram STT", () => {
  const body = {
    metadata: { request_id: "r1" },
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript: "click settings",
              confidence: 0.98,
              words: [
                { word: "click", punctuated_word: "Click", start: 0.1, end: 0.4, confidence: 0.99 },
                { word: "settings", punctuated_word: "settings.", start: 0.45, end: 0.9, confidence: 0.97 },
              ],
            },
          ],
        },
      ],
    },
  };

  it("posts raw WAV with Token auth, nova-3 and keyterms", async () => {
    const m = mockFetch(200, body);
    const stt = createDeepgramStt({ apiKey: "dg-test", fetch: m.fetch });
    const r = await stt.transcribe([{ samples: audio, sampleRate: 16_000 }], {
      language: "en",
      keyterms: ["Settings", "Invoices", "Settings"],
    });
    expect(r.ok && r.value.text).toBe("click settings");
    expect(r.ok && r.value.segments).toEqual([
      { text: "Click", startMs: 100, endMs: 400, confidence: 0.99 },
      { text: "settings.", startMs: 450, endMs: 900, confidence: 0.97 },
    ]);
    const call = m.calls[0];
    const url = new URL(call?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://api.deepgram.com/v1/listen");
    expect(url.searchParams.get("model")).toBe("nova-3");
    expect(url.searchParams.get("language")).toBe("en");
    expect(url.searchParams.getAll("keyterm")).toEqual(["Settings", "Invoices"]);
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("authorization")).toBe("Token dg-test");
    expect(headers.get("content-type")).toBe("audio/wav");
    const sent = call?.init?.body as Uint8Array;
    expect(String.fromCharCode(...sent.subarray(0, 4))).toBe("RIFF");
  });

  it("caps keyterms at 50", () => {
    const terms = Array.from({ length: 80 }, (_, i) => `t${i}`);
    const url = new URL(deepgramUrl("https://x/v1", "nova-3", { keyterms: terms }));
    expect(url.searchParams.getAll("keyterm")).toHaveLength(50);
  });

  it("returns empty text when nothing was heard", async () => {
    const m = mockFetch(200, { results: { channels: [{ alternatives: [{ transcript: "" }] }] } });
    const r = await createDeepgramStt({ apiKey: "k", fetch: m.fetch }).transcribe(audio);
    expect(r.ok && r.value.text).toBe("");
  });
});

describe("stub backends", () => {
  it.each(Object.keys(STUB_BACKENDS) as StubBackendId[])("%s returns not_configured", async (id) => {
    const r = await createStubStt(id).transcribe(audio);
    expect(r.ok ? "ok" : [r.error.kind, r.error.backend]).toEqual(["not_configured", id]);
  });
});
