// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Reads events.jsonl back, validating every line, and extracts what replay needs.
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  type Action,
  type Effect,
  err,
  ok,
  type RecorderError,
  type Result,
  RunEvent,
} from "@ghosthand/protocol";
import { EVENTS_FILE } from "./run-folder.ts";
import { SAFE_RUN_ID } from "./run-id.ts";
import { defaultRunsDir } from "./runs-dir.ts";

export type CorruptLine = { readonly line: number; readonly message: string };

/** A RecorderError; `corrupt` carries the 1-based line numbers that failed. */
export type ReadRunError = RecorderError & { readonly lines?: readonly CorruptLine[] };

export type RunLog = { readonly folder: string; readonly events: RunEvent[] };

export type ReadRunOptions = { readonly runsDir?: string };

function resolveFolder(runIdOrFolder: string, runsDir: string | undefined): string {
  if (isAbsolute(runIdOrFolder) || /[\\/]/.test(runIdOrFolder) || !SAFE_RUN_ID.test(runIdOrFolder)) {
    return runIdOrFolder;
  }
  return join(runsDir ?? defaultRunsDir(), runIdOrFolder);
}

/** Parses JSONL text. Every non-blank line must be a valid RunEvent and `seq` must strictly increase. */
export function parseEvents(text: string): Result<RunEvent[], ReadRunError> {
  const events: RunEvent[] = [];
  const bad: CorruptLine[] = [];
  let lastSeq = -1;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]?.trim() ?? "";
    if (raw === "") continue;
    const line = i + 1;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      bad.push({ line, message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    const parsed = RunEvent.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
      bad.push({ line, message: `schema: ${issue?.message ?? "invalid"}${where}` });
      continue;
    }
    if (parsed.data.seq <= lastSeq) {
      bad.push({ line, message: `seq ${parsed.data.seq} does not follow ${lastSeq}` });
      continue;
    }
    lastSeq = parsed.data.seq;
    events.push(parsed.data);
  }
  if (bad.length > 0) {
    const shown = bad
      .slice(0, 5)
      .map((b) => `line ${b.line}: ${b.message}`)
      .join("; ");
    const more = bad.length > 5 ? ` (+${bad.length - 5} more)` : "";
    return err({ kind: "corrupt", message: `${bad.length} bad line(s): ${shown}${more}`, lines: bad });
  }
  return ok(events);
}

/** Reads `<folder>/events.jsonl`. Accepts a run id (resolved under runsDir) or a folder path. */
export function readRun(runIdOrFolder: string, opts: ReadRunOptions = {}): Result<RunLog, ReadRunError> {
  const folder = resolveFolder(runIdOrFolder, opts.runsDir);
  const file = join(folder, EVENTS_FILE);
  if (!existsSync(folder) || !statSync(folder).isDirectory() || !existsSync(file)) {
    return err({ kind: "not_found", message: `no ${EVENTS_FILE} in ${folder}` });
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return err({ kind: "io", message: `cannot read ${file}: ${e instanceof Error ? e.message : String(e)}` });
  }
  const events = parseEvents(text);
  return events.ok ? ok({ folder, events: events.value }) : events;
}

type ActionEvent = Extract<RunEvent, { type: "action" }>;

export type ReplayAction = {
  readonly step: number;
  readonly seq: number;
  readonly action: Action;
  /** Fingerprint of the target element; tokens are only valid for their snapshot. */
  readonly target: ActionEvent["target"] | null;
  readonly effect: Effect;
};

const REPLAYABLE: ReadonlySet<Effect> = new Set<Effect>(["confirmed", "partial", "unverifiable"]);

/**
 * Actions in log order, each paired with the first `effect` event of the same step that follows it.
 * Only actions whose effect was confirmed, partial or unverifiable are returned; actions with no
 * effect record, a suspected no-op or a refusal are dropped.
 */
export function actionsForReplay(events: readonly RunEvent[]): ReplayAction[] {
  const out: ReplayAction[] = [];
  let pending: ActionEvent | null = null;
  for (const e of events) {
    if (e.type === "action") {
      pending = e;
    } else if (e.type === "effect" && pending !== null && pending.step === e.step) {
      if (REPLAYABLE.has(e.result.effect)) {
        out.push({
          step: pending.step,
          seq: pending.seq,
          action: pending.action,
          target: pending.target ?? null,
          effect: e.result.effect,
        });
      }
      pending = null;
    }
  }
  return out;
}
