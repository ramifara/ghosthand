// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Writer hand-off over an AgentConsultant (the user's own Codex or Claude CLI), for setups without an API key.
// One warm read-only session; each hint is one turn with a strict output schema.
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
import type { AgentConsultant, ConsultantError, ConsultantSession, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";

export const WRITER_HINT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "content"],
  properties: {
    kind: { type: "string", enum: ["focus", "text", "none"] },
    content: { type: "string", minLength: 1, maxLength: 600 },
  },
} as const;

// Strict mode (Codex): every property is required; optional ones are nullable.
export const SHORTLIST_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks", "text", "note"],
  properties: {
    picks: { type: "array", maxItems: MAX_SHORTLIST, items: { type: "string", minLength: 1, maxLength: 40 } },
    text: { type: ["string", "null"], maxLength: 600 },
    note: { type: ["string", "null"], maxLength: 300 },
  },
} as const;

/** Keeps only ids that exist in the candidate lines (`id — ...`), in the model's order. */
export function parseShortlist(v: unknown, candidates: readonly string[]): Shortlist {
  if (!v || typeof v !== "object") throw new Error("shortlist is not an object");
  const { picks, text, note } = v as { picks?: unknown; text?: unknown; note?: unknown };
  if (!Array.isArray(picks)) throw new Error("shortlist picks missing");
  const ids = new Set(candidates.map((line) => line.split(" — ")[0]?.trim() ?? ""));
  const kept = [...new Set(picks.filter((p): p is string => typeof p === "string").map((p) => p.trim()))]
    .filter((p) => ids.has(p))
    .slice(0, MAX_SHORTLIST);
  return {
    picks: kept,
    ...(typeof text === "string" && text.trim() ? { text: text.trim() } : {}),
    ...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}),
  };
}

export function parseWriterHint(v: unknown): WriterHint {
  if (!v || typeof v !== "object") throw new Error("hint is not an object");
  const { kind, content } = v as { kind?: unknown; content?: unknown };
  if (typeof content !== "string" || content.length === 0) throw new Error("hint content missing");
  if (kind === "focus") return { kind, focus: content };
  if (kind === "text") return { kind, text: content };
  if (kind === "none") return { kind, reason: content };
  throw new Error(`unknown hint kind ${String(kind)}`);
}

function writerError(e: ConsultantError): WriterError {
  switch (e.kind) {
    case "timeout":
      return { kind: "timeout", message: e.message };
    case "cancelled":
      return { kind: "aborted", message: e.message };
    case "schema_failed":
      return { kind: "invalid", message: e.message };
    default:
      return { kind: "unavailable", message: `${e.kind}: ${e.message}` };
  }
}

export interface ConsultantWriter extends Writer {
  close(): Promise<void>;
}

export function createConsultantWriter(
  consultant: AgentConsultant,
  opts: { model?: string; timeoutMs?: number } = {},
): ConsultantWriter {
  let session: Promise<Result<ConsultantSession, ConsultantError>> | undefined;
  const getSession = () => {
    session ??= consultant.open({ system: WRITER_SYSTEM, ...(opts.model ? { model: opts.model } : {}) });
    return session;
  };
  const drop = async () => {
    const current = session;
    session = undefined;
    const r = await current;
    if (r?.ok) await r.value.close();
  };
  return {
    id: `${consultant.id}:writer`,
    async hint(input, call = {}) {
      const started = Date.now();
      const s = await getSession();
      if (!s.ok) {
        session = undefined;
        return err(writerError(s.error));
      }
      const r = await s.value.ask<WriterHint>({
        prompt: writerPrompt(input),
        schema: WRITER_HINT_JSON_SCHEMA,
        parse: parseWriterHint,
        effort: "low",
        timeoutMs: opts.timeoutMs ?? 30_000,
        ...(call.signal ? { signal: call.signal } : {}),
      });
      if (!r.ok) {
        if (r.error.kind === "process" || r.error.kind === "timeout" || r.error.kind === "cancelled")
          await drop();
        return err(writerError(r.error));
      }
      return ok({
        hint: r.value,
        model: opts.model ?? consultant.id,
        latencyMs: Date.now() - started,
        costUsd: 0,
      });
    },
    async shortlist(input, call = {}) {
      const started = Date.now();
      const s = await getSession();
      if (!s.ok) {
        session = undefined;
        return err(writerError(s.error));
      }
      const r = await s.value.ask<Shortlist>({
        prompt: `${SHORTLIST_SYSTEM}\n\n${shortlistPrompt(input)}`,
        schema: SHORTLIST_JSON_SCHEMA,
        parse: (v) => parseShortlist(v, input.candidates),
        effort: "low",
        timeoutMs: opts.timeoutMs ?? 30_000,
        ...(call.signal ? { signal: call.signal } : {}),
      });
      if (!r.ok) {
        if (r.error.kind === "process" || r.error.kind === "timeout" || r.error.kind === "cancelled")
          await drop();
        return err(writerError(r.error));
      }
      return ok({
        shortlist: r.value,
        model: opts.model ?? consultant.id,
        latencyMs: Date.now() - started,
        costUsd: 0,
      });
    },
    close: drop,
  };
}
