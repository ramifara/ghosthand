// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Writes one run folder: events.jsonl, screenshots, state sidecars and summary.json.
// Every text artifact passes through `redact` (registered secret values) right before it is written.
// Writes are synchronous, so lines are appended in exactly the order `emit` is called.
import { closeSync, existsSync, mkdirSync, openSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type RecorderError, type Result, RunEvent, type RunEventDraft } from "@ghosthand/protocol";
import { redactKeys } from "./redact-keys.ts";
import { type RunPaths, runPaths, screenshotName, stateName } from "./run-folder.ts";
import { createRunId, SAFE_RUN_ID } from "./run-id.ts";
import type { RunIndex } from "./run-index.ts";
import { RunSummary, toRunRecord } from "./run-record.ts";
import { emptySummary, foldSummary } from "./run-summary.ts";

/** Replaces registered secret values in text. Supplied by the caller (the SecretsRegistry in core). */
export type Redact = (text: string) => string;

export type RunRecorderOptions = {
  readonly runsDir: string;
  /** Defaults to a fresh sortable id from the clock. */
  readonly runId?: string;
  readonly redact: Redact;
  /** Milliseconds since epoch. Defaults to Date.now. */
  readonly clock?: () => number;
  /** When given, the run is indexed on `run.start` and updated on `finish()`. */
  readonly index?: RunIndex;
};

/** Fields a caller may override in summary.json and the index when finishing. */
export type RunSummaryPatch = Partial<Omit<RunSummary, "id" | "eventCount">>;

export type RunRecorder = {
  readonly runId: string;
  readonly paths: RunPaths;
  /** Assigns t, seq and runId, validates, redacts and appends one line. Returns the validated (unredacted) event. */
  emit(draft: RunEventDraft): Result<RunEvent, RecorderError>;
  /** Writes `screenshots/step-NNN.png` and returns the file name (`step-NNN.png`). */
  writeScreenshot(step: number, bytes: Uint8Array): Result<string, RecorderError>;
  /** Writes `states/step-NNN-<purpose>.json` (key- and value-redacted) and returns the file name. */
  writeState(step: number, purpose: string, state: unknown): Result<string, RecorderError>;
  /** Summary of the events emitted so far. */
  summary(): RunSummary;
  /** Closes the event log, writes summary.json and updates the index. Idempotent after success. */
  finish(patch?: RunSummaryPatch): Result<RunSummary, RecorderError>;
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const io = (what: string, e: unknown): RecorderError => ({ kind: "io", message: `${what}: ${message(e)}` });

/** JSON-stringify, redact the text, and check the result still parses. */
function redactedJson(value: unknown, redact: Redact, space?: number): Result<string, RecorderError> {
  let text: string | undefined;
  try {
    text = JSON.stringify(value, null, space);
  } catch (e) {
    return err(io("value is not serialisable", e));
  }
  const out = redact(text ?? "null");
  try {
    JSON.parse(out);
  } catch {
    return err({ kind: "corrupt", message: "redaction produced invalid JSON; nothing was written" });
  }
  return ok(out);
}

function redactStrings<T extends Record<string, unknown>>(value: T, redact: Redact): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = typeof v === "string" ? redact(v) : v;
  return out as T;
}

export function createRunRecorder(opts: RunRecorderOptions): Result<RunRecorder, RecorderError> {
  const clock = opts.clock ?? Date.now;
  const redact = opts.redact;
  const openedAt = clock();
  const runId = opts.runId ?? createRunId(openedAt);
  if (!SAFE_RUN_ID.test(runId)) {
    return err({ kind: "io", message: `run id ${JSON.stringify(runId)} is not a safe folder name` });
  }
  const paths = runPaths(join(opts.runsDir, runId));
  if (existsSync(paths.events))
    return err({ kind: "io", message: `run folder ${paths.folder} already has events` });

  let fd: number;
  try {
    for (const dir of [paths.folder, paths.screenshotsDir, paths.statesDir, paths.videoDir]) {
      mkdirSync(dir, { recursive: true });
    }
    fd = openSync(paths.events, "a", 0o600);
  } catch (e) {
    return err(io(`cannot create run folder ${paths.folder}`, e));
  }

  let seq = 0;
  let closed = false;
  let finished: RunSummary | null = null;
  let acc = emptySummary(runId, openedAt);

  const indexNow = (s: RunSummary): Result<void, RecorderError> =>
    opts.index ? opts.index.indexRun(redactStrings(toRunRecord(s, paths.folder), redact)) : ok(undefined);

  const recorder: RunRecorder = {
    runId,
    paths,

    emit(draft) {
      if (closed) return err({ kind: "io", message: `run ${runId} is finished; event not written` });
      const parsed = RunEvent.safeParse({ ...draft, t: clock(), seq, runId });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
        return err({ kind: "corrupt", message: `invalid ${draft.type} event: ${issue?.message}${where}` });
      }
      const event = parsed.data;
      const line = redactedJson(redactKeys(event), redact);
      if (!line.ok) return line;
      try {
        writeSync(fd, `${line.value}\n`);
      } catch (e) {
        return err(io(`cannot append to ${paths.events}`, e));
      }
      seq += 1;
      acc = foldSummary(acc, event);
      if (event.type === "run.start") {
        const indexed = indexNow(acc);
        if (!indexed.ok) return indexed;
      }
      return ok(event);
    },

    writeScreenshot(step, bytes) {
      const name = screenshotName(step);
      try {
        writeFileSync(join(paths.screenshotsDir, name), bytes, { mode: 0o600 });
      } catch (e) {
        return err(io(`cannot write screenshot ${name}`, e));
      }
      return ok(name);
    },

    writeState(step, purpose, state) {
      const name = stateName(step, purpose);
      const text = redactedJson(redactKeys(state), redact, 2);
      if (!text.ok) return text;
      try {
        writeFileSync(join(paths.statesDir, name), `${text.value}\n`, { mode: 0o600 });
      } catch (e) {
        return err(io(`cannot write state ${name}`, e));
      }
      return ok(name);
    },

    summary: () => acc,

    finish(patch = {}) {
      if (finished) return ok(finished);
      if (!closed) {
        try {
          closeSync(fd);
        } catch (e) {
          return err(io(`cannot close ${paths.events}`, e));
        }
        closed = true;
      }
      const merged = RunSummary.safeParse({ ...acc, endedAt: acc.endedAt ?? clock(), ...patch });
      if (!merged.success)
        return err({ kind: "corrupt", message: `invalid summary: ${merged.error.message}` });
      const summary = merged.data;
      const text = redactedJson(summary, redact, 2);
      if (!text.ok) return text;
      try {
        writeFileSync(paths.summary, `${text.value}\n`, { mode: 0o600 });
      } catch (e) {
        return err(io("cannot write summary.json", e));
      }
      const indexed = indexNow(summary);
      if (!indexed.ok) return indexed;
      finished = summary;
      return ok(summary);
    },
  };
  return ok(recorder);
}
