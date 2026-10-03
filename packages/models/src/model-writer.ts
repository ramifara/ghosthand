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

/** One line the writer can answer with when JSON-schema output is not available. */
export const WRITER_TEXT_FORMAT =
  "Answer with exactly one line in one of these forms, nothing else: FOCUS: <one next move> | TEXT: <text to type> | NONE: <why>";

/** Parses the one-line text format; undefined when the line fits none of the forms. */
export function parseWriterLine(text: string): WriterDraft | undefined {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^(FOCUS|TEXT|NONE)\s*:/i.test(l));
  if (!line) return undefined;
  const m = /^(FOCUS|TEXT|NONE)\s*:\s*(.*)$/i.exec(line);
  const content = (m?.[2] ?? "").trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!m || content.length === 0) return undefined;
  const kind = m[1]?.toLowerCase() as WriterDraft["kind"];
  return { kind, content: content.slice(0, 600) };
}

export function createModelWriter(client: ModelClient, opts: { timeoutMs?: number } = {}): Writer {
  const timeoutMs = opts.timeoutMs ?? 8000;
  return {
    id: "models:writer",
    async hint(input, callOpts = {}) {
      const signal = callOpts.signal ? { signal: callOpts.signal } : {};
      let r = await client.generateStructured({
        role: "writer",
        system: WRITER_SYSTEM,
        prompt: writerPrompt(input),
        schema: WriterDraft,
        schemaName: "writer_hint",
        timeoutMs,
        maxOutputTokens: 400,
        ...signal,
      });
      // A provider that cannot follow a JSON schema (the ChatGPT plan did not) gets one plain-text ask.
      if (!r.ok && r.error.kind === "schema_failed") {
        const t = await client.generateText({
          role: "writer",
          system: `${WRITER_SYSTEM} ${WRITER_TEXT_FORMAT}`,
          prompt: writerPrompt(input),
          timeoutMs,
          maxOutputTokens: 200,
          ...signal,
        });
        if (!t.ok) return err(mapError(t.error));
        const draft = parseWriterLine(t.value.value);
        if (!draft)
          return err({
            kind: "invalid",
            message: `the writer answered in neither JSON nor the one-line form: ${t.value.value.slice(0, 120)}`,
          });
        r = { ...t, value: { ...t.value, value: draft } };
      }
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
