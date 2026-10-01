// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Shared test helpers (not exported from the package).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RunEventDraft, TaskSpec } from "@ghosthand/protocol";

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "ghosthand-recorder-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function startDraft(instruction = "Sign in as alice"): RunEventDraft {
  return {
    type: "run.start",
    task: TaskSpec.parse({ id: "l1-login", instruction, startUrl: "http://127.0.0.1:4400/login" }),
    decisionModel: "jev-1.13.0",
    surface: "web",
    gitSha: "abc1234",
  };
}

export function endDraft(): RunEventDraft {
  return {
    type: "run.end",
    outcome: "success",
    reason: "done_when satisfied",
    steps: 1,
    wallMs: 1200,
    costUsd: 0.00002,
    decisionCalls: 2,
    modelCalls: 0,
    modeShares: { B: 1 },
  };
}

/** Every file under `dir`, recursively, with its bytes decoded as latin1 (safe for binaries). */
export function readTree(dir: string): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) {
      const file = join(e.parentPath, e.name);
      out.push({ file, text: readFileSync(file).toString("latin1") });
    }
  }
  return out;
}
