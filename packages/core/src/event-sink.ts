// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Where the loop sends typed events; the recorder implements it.
import type { RunEventDraft } from "@ghosthand/protocol";

/** Receives typed events; the recorder implements it. */
export interface EventSink {
  emit(draft: RunEventDraft): void;
  /** Writes a capture for `step` and returns its file name; `label` names an extra capture (what Jev saw). */
  writeScreenshot?(step: number, bytes: Uint8Array, label?: string): string;
  /** The file name writeScreenshot will use for `step`, so the capture can finish off the critical path. */
  screenshotName?(step: number): string;
  writeState?(step: number, purpose: string, state: unknown): string;
}
