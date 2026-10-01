// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The engine's launcher returns a protocol `Computer`; the web one (driver-playwright's WebComputer)
// can also screencast and bring its page to the front for takeover.
import type { ProfileError } from "@ghosthand/driver-playwright";
import type { Computer, IpcError, ScreencastFrame } from "@ghosthand/protocol";

export interface ScreencastCapable {
  startScreencast(onFrame: (frame: ScreencastFrame) => void): Promise<unknown>;
  stopScreencast(): Promise<void>;
  readonly page: { bringToFront(): Promise<void> };
}

export function isScreencastCapable(c: Computer): c is Computer & ScreencastCapable {
  const candidate = c as Partial<ScreencastCapable>;
  return typeof candidate.startScreencast === "function" && typeof candidate.stopScreencast === "function";
}

export function createIpcErrorFromProfile(e: ProfileError): { ok: false; error: IpcError } {
  const kind: IpcError["kind"] =
    e.kind === "invalid_name" || e.kind === "invalid_source" || e.kind === "profile_exists"
      ? "invalid_input"
      : e.kind === "profile_not_found"
        ? "not_found"
        : e.kind === "profile_locked"
          ? "busy"
          : "engine";
  return { ok: false, error: { kind, message: e.message } };
}
