// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Maps Codex failures (turn errors, JSON-RPC errors, exec output) onto ConsultantError kinds.
import type { ConsultantError, ConsultantErrorKind } from "@ghosthand/protocol";
import type { JsonRpcFailure } from "./json-rpc-client.ts";

const usageLimitInfos = new Set(["usageLimitExceeded", "rateLimitExceeded", "sessionBudgetExceeded"]);

/** `codexErrorInfo` is either a string tag or a single-key object such as `{httpConnectionFailed: {...}}`. */
export function codexErrorTag(info: unknown): string | undefined {
  if (typeof info === "string") return info;
  if (typeof info === "object" && info !== null && !Array.isArray(info)) return Object.keys(info)[0];
  return undefined;
}

export function kindFromCodexErrorInfo(info: unknown): ConsultantErrorKind {
  const tag = codexErrorTag(info);
  if (tag === undefined) return "process";
  if (usageLimitInfos.has(tag)) return "usage_limit";
  if (tag === "unauthorized") return "unauthenticated";
  const status = typeof info === "object" && info !== null ? Object.values(info)[0] : undefined;
  const http =
    typeof status === "object" && status !== null ? Reflect.get(status, "httpStatusCode") : undefined;
  if (http === 401) return "unauthenticated";
  if (http === 429) return "usage_limit";
  return "process";
}

/** Text heuristics for places that only give us a message (exec JSONL, JSON-RPC errors, stderr). */
export function kindFromMessage(message: string): ConsultantErrorKind {
  if (/\b401\b|unauthori[sz]ed|not logged in|authentication required|codex login/i.test(message)) {
    return "unauthenticated";
  }
  if (/usage limit|rate limit|\b429\b|too many requests|quota/i.test(message)) return "usage_limit";
  return "process";
}

export function fromTurnError(error: { message: string; codexErrorInfo?: unknown }): ConsultantError {
  const byInfo = kindFromCodexErrorInfo(error.codexErrorInfo);
  return { kind: byInfo === "process" ? kindFromMessage(error.message) : byInfo, message: error.message };
}

export function fromRpcFailure(failure: JsonRpcFailure): ConsultantError {
  switch (failure.kind) {
    case "timeout":
      return { kind: "timeout", message: failure.message };
    case "cancelled":
      return { kind: "cancelled", message: failure.message };
    case "closed":
      return {
        kind: "process",
        message: `codex app-server closed during ${failure.method}: ${failure.message}`,
      };
    case "rpc":
      return {
        kind: kindFromMessage(failure.message),
        message: `${failure.method} failed (${failure.code}): ${failure.message}`,
      };
  }
}
