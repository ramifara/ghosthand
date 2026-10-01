// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Writes one audit_log row per mutating request, after the handler has run.
import type { AuditOutcome, UserRow } from "@ghosthand/testbed-kit";
import type { MiddlewareHandler } from "hono";
import type { Testbed } from "./testbed.ts";

export interface AuditNote {
  action?: string;
  actor?: string;
  outcome?: AuditOutcome;
  detail?: Record<string, unknown>;
}

export type Env = { Variables: { audit: AuditNote; user: UserRow | undefined } };

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function outcomeFor(status: number): AuditOutcome {
  if (status >= 500) return "error";
  if (status >= 400) return "rejected";
  return "ok";
}

export function auditMiddleware(testbed: Testbed, defaultActor: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    c.set("audit", {});
    await next();
    if (!MUTATING.has(c.req.method)) return;
    const note = c.get("audit");
    const path = new URL(c.req.url).pathname;
    testbed.audit({
      actor: note.actor ?? c.get("user")?.email ?? defaultActor,
      method: c.req.method,
      path,
      action: note.action ?? `${c.req.method.toLowerCase()} ${path}`,
      outcome: note.outcome ?? outcomeFor(c.res.status),
      detail: note.detail ?? {},
    });
  };
}
