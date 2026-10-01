// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// One promise that settles when an ask times out, is aborted by the caller, or is interrupted.
import type { ConsultantError } from "@ghosthand/protocol";

export type StopReason = "timeout" | "cancelled" | "interrupted";

export interface StopWatch {
  readonly stopped: Promise<StopReason>;
  /** Stops with `interrupted` (from `session.interrupt()`). */
  interrupt(): void;
  dispose(): void;
}

export function watchStop(timeoutMs: number, signal?: AbortSignal): StopWatch {
  let settle: (r: StopReason) => void = () => {};
  const stopped = new Promise<StopReason>((resolve) => {
    settle = resolve;
  });
  const timer = setTimeout(() => settle("timeout"), timeoutMs);
  const onAbort = (): void => settle("cancelled");
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) settle("cancelled");
  return {
    stopped,
    interrupt: () => settle("interrupted"),
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export function stopError(reason: StopReason, timeoutMs: number): ConsultantError {
  switch (reason) {
    case "timeout":
      return { kind: "timeout", message: `Codex did not answer within ${timeoutMs} ms` };
    case "cancelled":
      return { kind: "cancelled", message: "the ask was aborted by the caller" };
    case "interrupted":
      return { kind: "cancelled", message: "the turn was interrupted" };
  }
}
