// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Test transport: serves hand-written OpenAI Responses API recordings from `__recordings__` through
// an injected `fetch`. Nothing here touches the network. Not exported from the package.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const Recording = z.object({
  description: z.string(),
  request: z.record(z.string(), z.unknown()),
  response: z.object({
    status: z.number().int(),
    headers: z.record(z.string(), z.string()),
    body: z.unknown(),
  }),
});
export type Recording = z.infer<typeof Recording>;

export function loadRecording(name: string): Recording {
  const file = join(import.meta.dirname, "__recordings__", `${name}.json`);
  return Recording.parse(JSON.parse(readFileSync(file, "utf8")));
}

export interface RecordedCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

export interface RecordedFetch {
  readonly fetch: FetchLike;
  readonly calls: RecordedCall[];
}

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("The operation was aborted.", "AbortError");

function capture(calls: RecordedCall[], input: string | URL | Request, init: RequestInit | undefined): void {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => {
    headers[k] = v;
  });
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  calls.push({ url, headers, body });
}

/** Serves the named recordings in order; the last one repeats. */
export function recordedFetch(...names: string[]): RecordedFetch {
  const recordings = names.map(loadRecording);
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (input, init) => {
    capture(calls, input, init);
    const signal = init?.signal;
    if (signal?.aborted) throw abortError(signal);
    const rec = recordings[Math.min(calls.length - 1, recordings.length - 1)];
    if (!rec) throw new Error("recordedFetch: no recordings given");
    const { status, headers, body } = rec.response;
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
  };
  return { fetch, calls };
}

/** Never answers; settles only when the request signal aborts (timeouts, caller aborts). */
export function hangingFetch(): RecordedFetch {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = (input, init) => {
    capture(calls, input, init);
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) reject(abortError(signal));
      signal.addEventListener("abort", () => reject(abortError(signal)), { once: true });
    });
  };
  return { fetch, calls };
}

/** Fails like a DNS or TLS error would under undici. */
export function failingFetch(): RecordedFetch {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (input, init) => {
    capture(calls, input, init);
    throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND api.openai.com") });
  };
  return { fetch, calls };
}
