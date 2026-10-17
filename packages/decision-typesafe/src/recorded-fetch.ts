// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Test transport: serves hand-written recordings from `__recordings__` through an injected `fetch`.
// Nothing here touches the network. Not exported from the package.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { z } from "zod";
import type { FetchLike } from "./typesafe-provider.ts";

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

export interface RecordedPart {
  name: string;
  contentType: string | undefined;
  bytes: Uint8Array;
}

export interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  /** The JSON payload: the whole body, or the `request` part of a multipart body. */
  body: unknown;
  /** File parts of a multipart body (images), in order. Empty for JSON bodies. */
  parts: RecordedPart[];
}

export interface RecordedFetch {
  fetch: FetchLike;
  calls: RecordedCall[];
}

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("The operation was aborted.", "AbortError");

const bytesOf = (body: RequestInit["body"]): Uint8Array | undefined => {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return undefined;
};

const indexOf = (hay: Uint8Array, needle: Uint8Array, from = 0): number => {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
};

/** Splits an RFC 7578 body into its parts: the `request` JSON and the file parts. */
function parseMultipart(bytes: Uint8Array, boundary: string): { body: unknown; parts: RecordedPart[] } {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const delimiter = enc.encode(`--${boundary}`);
  const crlf2 = enc.encode("\r\n\r\n");
  const parts: RecordedPart[] = [];
  let body: unknown;
  let pos = indexOf(bytes, delimiter);
  while (pos !== -1) {
    pos += delimiter.length;
    if (bytes[pos] === 45 && bytes[pos + 1] === 45) break; // closing "--"
    const headEnd = indexOf(bytes, crlf2, pos);
    if (headEnd === -1) break;
    const head = dec.decode(bytes.subarray(pos + 2, headEnd));
    const next = indexOf(bytes, delimiter, headEnd);
    const content = bytes.subarray(headEnd + 4, next === -1 ? bytes.length : next - 2);
    const name = /name="([^"]*)"/.exec(head)?.[1] ?? "";
    const contentType = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim();
    if (name === "request") body = JSON.parse(dec.decode(content)) as unknown;
    else parts.push({ name, contentType, bytes: new Uint8Array(content) });
    pos = next;
  }
  return { body, parts };
}

function capture(calls: RecordedCall[], url: string, init: RequestInit | undefined): void {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => {
    headers[k] = v;
  });
  let raw = bytesOf(init?.body);
  if (raw !== undefined && headers["content-encoding"] === "zstd")
    raw = new Uint8Array(zstdDecompressSync(raw));
  const boundary = /boundary=([^;]+)/.exec(headers["content-type"] ?? "")?.[1];
  if (raw === undefined) {
    calls.push({ url, headers, body: undefined, parts: [] });
  } else if (boundary !== undefined) {
    calls.push({ url, headers, ...parseMultipart(raw, boundary) });
  } else {
    calls.push({ url, headers, body: JSON.parse(new TextDecoder().decode(raw)) as unknown, parts: [] });
  }
}

/** Serves the named recordings in order; the last one repeats (so retries see it again). */
export function recordedFetch(...names: string[]): RecordedFetch {
  const recordings = names.map(loadRecording);
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    capture(calls, url, init);
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
  const fetch: FetchLike = (url, init) => {
    capture(calls, url, init);
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
  const fetch: FetchLike = async (url, init) => {
    capture(calls, url, init);
    throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND api.typesafe.ai") });
  };
  return { fetch, calls };
}
