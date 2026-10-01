// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Expected failures of the profile store and Chrome profile import.

import type { ComputerError } from "@ghosthand/protocol";

export type ProfileErrorKind =
  | "invalid_name"
  | "profile_exists"
  | "profile_not_found"
  | "profile_locked"
  | "invalid_source"
  | "io";

export interface ProfileError {
  readonly kind: ProfileErrorKind;
  readonly message: string;
}

export function profileError(kind: ProfileErrorKind, message: string): ProfileError {
  return { kind, message };
}

/** Wraps a thrown `node:fs` error as an `io` profile error. */
export function ioError(action: string, cause: unknown): ProfileError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return { kind: "io", message: `${action}: ${detail}` };
}

/** Profile failures surface from `launchPersistent` as `profile_locked` or `launch_failed`. */
export function toComputerError(error: ProfileError): ComputerError {
  return {
    kind: error.kind === "profile_locked" ? "profile_locked" : "launch_failed",
    message: error.message,
  };
}
