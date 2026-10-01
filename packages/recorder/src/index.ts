// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors

export const recorderPackageName = "@ghosthand/recorder" as const;

export { isSensitiveKey, REDACTED, redactKeys } from "./redact-keys.ts";
export {
  actionsForReplay,
  type CorruptLine,
  parseEvents,
  type ReadRunError,
  type ReadRunOptions,
  type ReplayAction,
  type RunLog,
  readRun,
} from "./replay-reader.ts";
export {
  EVENTS_FILE,
  INDEX_FILE,
  type RunPaths,
  runPaths,
  SUMMARY_FILE,
  screenshotName,
  stateName,
} from "./run-folder.ts";
export { createRunId, RUN_ID_PATTERN, randomSuffix, SAFE_RUN_ID } from "./run-id.ts";
export { INDEX_SCHEMA_VERSION, type ListRunsOptions, openRunIndex, type RunIndex } from "./run-index.ts";
export { RunRecord, RunSummary, toRunRecord } from "./run-record.ts";
export {
  createRunRecorder,
  type Redact,
  type RunRecorder,
  type RunRecorderOptions,
  type RunSummaryPatch,
} from "./run-recorder.ts";
export { emptySummary, foldSummary, runSummary } from "./run-summary.ts";
export { defaultRunsDir, type RunsDirEnv } from "./runs-dir.ts";
