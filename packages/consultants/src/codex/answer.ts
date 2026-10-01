// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Turns the final agent message into a validated value: JSON.parse, then the caller's `parse`.
import type { ConsultantError, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";

/** Tolerates a fenced ```json block, which some models emit even with a schema. */
function stripFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
  return m?.[1] ?? text;
}

export function parseAnswer<T>(
  text: string | undefined,
  parse: (value: unknown) => T,
): Result<T, ConsultantError> {
  if (text === undefined || text.trim() === "") {
    return err({ kind: "schema_failed", message: "the turn finished without a final agent message" });
  }
  let value: unknown;
  try {
    value = JSON.parse(stripFence(text));
  } catch (e) {
    return err({
      kind: "schema_failed",
      message: `final message is not JSON (${e instanceof Error ? e.message : String(e)}): ${text.slice(0, 200)}`,
    });
  }
  try {
    return ok(parse(value));
  } catch (e) {
    return err({
      kind: "schema_failed",
      message: `final message failed validation: ${e instanceof Error ? e.message : String(e)}`.slice(
        0,
        2000,
      ),
    });
  }
}
