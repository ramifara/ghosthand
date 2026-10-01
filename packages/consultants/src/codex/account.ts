// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// account/read, model/list and account/rateLimits/read, mapped onto protocol types.
import type { ConsultantError, ConsultantProbe, RateLimits, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { AppServerConnection } from "./app-server-connection.ts";
import type { AccountReadResult, CodexModel, CodexRateLimitSnapshot } from "./app-server-protocol.ts";
import {
  AccountReadResult as AccountReadSchema,
  ModelListResult,
  RateLimitsReadResult,
} from "./app-server-protocol.ts";

export interface AccountInfo {
  auth: ConsultantProbe["auth"];
  plan?: string;
  requiresOpenaiAuth: boolean;
}

export function accountInfo(r: AccountReadResult): AccountInfo {
  const { account } = r;
  if (account === null) return { auth: "none", requiresOpenaiAuth: r.requiresOpenaiAuth };
  if (account.type === "chatgpt") {
    const plan = "planType" in account && typeof account.planType === "string" ? account.planType : undefined;
    return {
      auth: "chatgpt",
      requiresOpenaiAuth: r.requiresOpenaiAuth,
      ...(plan === undefined ? {} : { plan }),
    };
  }
  if (account.type === "apiKey") return { auth: "api_key", requiresOpenaiAuth: r.requiresOpenaiAuth };
  return { auth: "unknown", requiresOpenaiAuth: r.requiresOpenaiAuth };
}

/** Signed out when the server needs OpenAI auth and reports no account. */
export function isSignedOut(info: AccountInfo): boolean {
  return info.auth === "none" && info.requiresOpenaiAuth;
}

export async function readAccount(conn: AppServerConnection): Promise<Result<AccountInfo, ConsultantError>> {
  const r = await conn.request("account/read", { refreshToken: false }, AccountReadSchema);
  return r.ok ? ok(accountInfo(r.value)) : r;
}

/** Follows `nextCursor` (bounded) and returns visible models, the default first. */
export async function listModels(conn: AppServerConnection): Promise<Result<CodexModel[], ConsultantError>> {
  const models: CodexModel[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await conn.request("model/list", cursor === undefined ? {} : { cursor }, ModelListResult);
    if (!r.ok) return r;
    models.push(...r.value.data);
    if (!r.value.nextCursor) break;
    cursor = r.value.nextCursor;
  }
  const visible = models.filter((m) => m.hidden !== true);
  return ok([...visible.filter((m) => m.isDefault), ...visible.filter((m) => !m.isDefault)]);
}

function mapWindow(w: {
  usedPercent: number;
  windowDurationMins?: number | null | undefined;
  resetsAt?: number | null | undefined;
}) {
  return {
    usedPercent: w.usedPercent,
    ...(w.windowDurationMins == null ? {} : { windowMinutes: w.windowDurationMins }),
    ...(w.resetsAt == null ? {} : { resetsAt: w.resetsAt }),
  };
}

export function mapRateLimits(s: CodexRateLimitSnapshot): RateLimits {
  return {
    ...(s.primary ? { primary: mapWindow(s.primary) } : {}),
    ...(s.secondary ? { secondary: mapWindow(s.secondary) } : {}),
  };
}

export interface RateLimitsDetail {
  limits: RateLimits;
  planType?: string;
  ordinaryUsageAllowed?: boolean;
  limitReached?: string;
}

export async function readRateLimits(
  conn: AppServerConnection,
): Promise<Result<RateLimitsDetail, ConsultantError>> {
  const r = await conn.request("account/rateLimits/read", undefined, RateLimitsReadResult);
  if (!r.ok) return r;
  const { rateLimits, ordinaryUsageAllowed } = r.value;
  return ok({
    limits: mapRateLimits(rateLimits),
    ...(rateLimits.planType ? { planType: rateLimits.planType } : {}),
    ...(ordinaryUsageAllowed == null ? {} : { ordinaryUsageAllowed }),
    ...(rateLimits.rateLimitReachedType ? { limitReached: rateLimits.rateLimitReachedType } : {}),
  });
}

export function unauthenticated(): ConsultantError {
  return { kind: "unauthenticated", message: "Codex is not signed in. Run `codex login` in a terminal." };
}

export function requireSignedIn(info: AccountInfo): Result<AccountInfo, ConsultantError> {
  return isSignedOut(info) ? err(unauthenticated()) : ok(info);
}
