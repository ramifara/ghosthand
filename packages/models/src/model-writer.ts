// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Writer hand-off over the models layer (role "writer"). Strict JSON: one focus hint, free text, or none.
import {
  MAX_SHORTLIST,
  SHORTLIST_SYSTEM,
  type Shortlist,
  shortlistPrompt,
  WRITER_SYSTEM,
  type Writer,
  type WriterError,
  type WriterHint,
  writerPrompt,
} from "@ghosthand/core";
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

// Strict JSON schemas (OpenAI) require every property; optional ones are nullable, never absent.
export const ShortlistDraft = z.object({
  picks: z.array(z.string().min(1).max(40)).max(MAX_SHORTLIST),
  text: z.string().max(600).nullable(),
  note: z.string().max(300).nullable(),
});

/** Keeps only ids that exist in the candidate lines (`id — ...`), in the model's order. */
export function cleanShortlist(
  draft: z.infer<typeof ShortlistDraft>,
  candidates: readonly string[],
): Shortlist {
  const ids = new Set(candidates.map((line) => line.split(" — ")[0]?.trim() ?? ""));
  const picks = [...new Set(draft.picks.map((p) => p.trim()))]
    .filter((p) => ids.has(p))
    .slice(0, MAX_SHORTLIST);
  return {
    picks,
    ...(draft.text?.trim() ? { text: draft.text.trim() } : {}),
    ...(draft.note?.trim() ? { note: draft.note.trim() } : {}),
  };
}

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

/** Plan-served models answer in 10-20 s when they reason first; 8 s cut every hint off (measured 16-18 s). */
export const WRITER_TIMEOUT_MS = 25_000;

/** One line the writer can answer a shortlist with when JSON-schema output is not available. */
export const SHORTLIST_TEXT_FORMAT =
  "Answer with exactly one line, nothing else: PICKS: <id>, <id>, ... | TEXT: <text to type or -> | NOTE: <one short reason>";

/** Parses the one-line shortlist form; undefined when no PICKS: part is found. */
export function parseShortlistLine(text: string, candidates: readonly string[]): Shortlist | undefined {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /PICKS\s*:/i.test(l));
  if (!line) return undefined;
  const part = (name: string) => {
    const m = new RegExp(`${name}\\s*:\\s*([^|]*)`, "i").exec(line);
    return m?.[1]?.trim() ?? "";
  };
  const picks = part("PICKS")
    .split(/[,\s]+/)
    .map((p) => p.replace(/[^\w-]/g, ""))
    .filter(Boolean);
  const typed = part("TEXT");
  const note = part("NOTE");
  return cleanShortlist(
    {
      picks: picks.slice(0, MAX_SHORTLIST),
      text: typed && typed !== "-" ? typed.slice(0, 600) : null,
      note: note ? note.slice(0, 300) : null,
    },
    candidates,
  );
}

export function createModelWriter(client: ModelClient, opts: { timeoutMs?: number } = {}): Writer {
  const timeoutMs = opts.timeoutMs ?? WRITER_TIMEOUT_MS;
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
        // Room for a reasoning model's hidden tokens before the answer; too little gives an empty reply.
        maxOutputTokens: 1200,
        ...signal,
      });
      // A provider that cannot follow a JSON schema (the ChatGPT plan did not) gets one plain-text ask.
      if (!r.ok && r.error.kind === "schema_failed") {
        const t = await client.generateText({
          role: "writer",
          system: `${WRITER_SYSTEM} ${WRITER_TEXT_FORMAT}`,
          prompt: writerPrompt(input),
          timeoutMs,
          maxOutputTokens: 1200,
          ...signal,
        });
        if (!t.ok) return err(mapError(t.error));
        const draft = parseWriterLine(t.value.value);
        if (!draft)
          return err({
            kind: "invalid",
            message: t.value.value.trim()
              ? `the writer answered in neither JSON nor the one-line form: ${t.value.value.slice(0, 120)}`
              : "the writer returned an empty answer (its output budget may have gone to reasoning)",
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
    async shortlist(input, callOpts = {}) {
      const signal = callOpts.signal ? { signal: callOpts.signal } : {};
      const r = await client.generateStructured({
        role: "writer",
        system: SHORTLIST_SYSTEM,
        prompt: shortlistPrompt(input),
        schema: ShortlistDraft,
        schemaName: "shortlist",
        timeoutMs,
        maxOutputTokens: 1200,
        ...signal,
      });
      // Some plan-served models answer in prose despite the schema: one plain-text ask in a one-line form.
      if (!r.ok && r.error.kind === "schema_failed") {
        const t = await client.generateText({
          role: "writer",
          system: `${SHORTLIST_SYSTEM} ${SHORTLIST_TEXT_FORMAT}`,
          prompt: shortlistPrompt(input),
          timeoutMs,
          maxOutputTokens: 1200,
          ...signal,
        });
        if (!t.ok) return err(mapError(t.error));
        const parsed = parseShortlistLine(t.value.value, input.candidates);
        if (!parsed)
          return err({
            kind: "invalid",
            message: t.value.value.trim()
              ? `the writer answered in neither JSON nor the PICKS: form: ${t.value.value.slice(0, 120)}`
              : "the writer returned an empty answer (its output budget may have gone to reasoning)",
          });
        return ok({
          shortlist: parsed,
          model: t.value.model,
          latencyMs: t.value.latencyMs,
          costUsd: t.value.costUsd,
        });
      }
      if (!r.ok) return err(mapError(r.error));
      return ok({
        shortlist: cleanShortlist(r.value.value, input.candidates),
        model: r.value.model,
        latencyMs: r.value.latencyMs,
        costUsd: r.value.costUsd,
      });
    },
  };
}
