// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Shared request plumbing for hosted STT backends: timeout + caller abort, status mapping, JSON parsing.
import { err, ok, type Result } from "@ghosthand/protocol";
import type { z } from "zod";
import { type SttBackendId, type SttError, sttErrorFromException, sttKindForStatus } from "./stt.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_STT_TIMEOUT_MS = 15_000;

export interface HostedSttOptions {
  apiKey: string | undefined;
  fetch?: FetchLike;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

/** Sends one request and parses a JSON body with `schema`. Never throws. */
export async function requestJson<T>(
  backend: SttBackendId,
  doFetch: FetchLike,
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
  opts: { timeoutMs: number; signal?: AbortSignal | undefined },
): Promise<Result<T, SttError>> {
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await doFetch(url, { ...init, signal });
  } catch (e) {
    if (timeout.aborted && !opts.signal?.aborted)
      return err({ kind: "timeout", message: `no answer in ${opts.timeoutMs} ms`, backend });
    return err(sttErrorFromException(e, backend, opts.signal));
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return err({
      kind: sttKindForStatus(res.status),
      message: `HTTP ${res.status}: ${text.slice(0, 300)}`,
      backend,
      status: res.status,
    });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return err({ kind: "provider", message: "response is not JSON", backend, status: res.status });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return err({ kind: "provider", message: `unexpected response: ${parsed.error.message}`, backend });
  }
  return ok(parsed.data);
}

export const notConfigured = (backend: SttBackendId, what: string): Result<never, SttError> =>
  err({ kind: "not_configured", message: what, backend });
