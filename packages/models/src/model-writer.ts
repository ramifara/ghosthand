// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Writer hand-off over the models layer (role "writer"). Strict JSON: one focus hint, free text, or none.
import { WRITER_SYSTEM, type Writer, type WriterError, type WriterHint, writerPrompt } from "@ghosthand/core";
import { err, ok } from "@ghosthand/protocol";
import { z } from "zod";
import type { ModelClient } from "./model-client.ts";
import type { ModelError } from "./model-error.ts";

export const WriterDraft = z.object({
  kind: z.enum(["focus", "text", "none"]),
  /** For focus: one next move in words. For text: the exact text to type. For none: why. */
  content: z.string().min(1).max(600),
});
export type WriterDraft = z.infer<typeof WriterDraft>;

export function toWriterHint(d: WriterDraft): WriterHint {
  if (d.kind === "focus") return { kind: "focus", focus: d.content };
  if (d.kind === "text") return { kind: "text", text: d.content };
  return { kind: "none", reason: d.content };
}

function mapError(e: ModelError): WriterError {
  switch (e.kind) {
    case "not_configured":
    case "auth":
    case "budget":
      return { kind: "unavailable", message: e.message };
    case "timeout":
      return { kind: "timeout", message: e.message };
    case "aborted":
      return { kind: "aborted", message: e.message };
    case "schema_failed":
    case "refused":
      return { kind: "invalid", message: e.message };
    default:
      return { kind: "provider", message: e.message };
  }
}

export function createModelWriter(client: ModelClient, opts: { timeoutMs?: number } = {}): Writer {
  return {
    id: "models:writer",
    async hint(input, callOpts = {}) {
      const r = await client.generateStructured({
        role: "writer",
        system: WRITER_SYSTEM,
        prompt: writerPrompt(input),
        schema: WriterDraft,
        schemaName: "writer_hint",
        timeoutMs: opts.timeoutMs ?? 8000,
        maxOutputTokens: 400,
        ...(callOpts.signal ? { signal: callOpts.signal } : {}),
      });
      if (!r.ok) return err(mapError(r.error));
      return ok({
        hint: toWriterHint(r.value.value),
        model: r.value.model,
        latencyMs: r.value.latencyMs,
        costUsd: r.value.costUsd,
      });
    },
  };
}
