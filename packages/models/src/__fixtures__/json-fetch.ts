// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Test transport that answers with inline JSON bodies and records each request. No network.

export interface JsonCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

export interface JsonReply {
  readonly status?: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export interface JsonFetch {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: JsonCall[];
}

/** Replies in order (the last one repeats), or from a function of the request URL. */
export function jsonFetch(replies: readonly JsonReply[] | ((url: string) => JsonReply | Error)): JsonFetch {
  const calls: JsonCall[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method: init?.method ?? "GET", headers, body });
    const reply =
      typeof replies === "function" ? replies(url) : replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply === undefined) throw new Error("jsonFetch: no replies given");
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
