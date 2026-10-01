// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The few `claude --output-format stream-json` events the consultant reads. Shapes recorded from
// Claude Code 2.1.285 on 2026-10-01 (docs/research/claude-consultant-probe.md). Parsing is lenient:
// unknown fields and event types are ignored.
import type { ConsultantError, ConsultantErrorKind, RateLimits } from "@ghosthand/protocol";
import { z } from "zod";

const Init = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  claude_code_version: z.string().optional(),
  permissionMode: z.string().optional(),
});

const Window = z.object({ utilization: z.number(), resetsAt: z.number().optional() });
const RateLimit = z.object({
  type: z.literal("rate_limit_event"),
  rate_limit_info: z.object({
    status: z.string(),
    resetsAt: z.number().optional(),
    rateLimitType: z.string().optional(),
    unifiedWindows: z.object({ five_hour: Window.optional(), seven_day: Window.optional() }).optional(),
  }),
});

const ResultEvent = z.object({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean().default(false),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  total_cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
  api_error_status: z.number().nullable().optional(),
  errors: z.array(z.unknown()).optional(),
});

export type ClaudeInit = z.infer<typeof Init>;
export type ClaudeRateLimit = z.infer<typeof RateLimit>["rate_limit_info"];
export type ClaudeResult = z.infer<typeof ResultEvent>;

export type ClaudeEvent =
  | { readonly kind: "init"; readonly init: ClaudeInit }
  | { readonly kind: "rate_limit"; readonly info: ClaudeRateLimit }
  | { readonly kind: "result"; readonly result: ClaudeResult }
  | { readonly kind: "other" };

export function parseClaudeEvent(line: string): ClaudeEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { kind: "other" };
  }
  const result = ResultEvent.safeParse(raw);
  if (result.success) return { kind: "result", result: result.data };
  const rate = RateLimit.safeParse(raw);
  if (rate.success) return { kind: "rate_limit", info: rate.data.rate_limit_info };
  const init = Init.safeParse(raw);
  if (init.success) return { kind: "init", init: init.data };
  return { kind: "other" };
}

/** Five-hour and seven-day windows as protocol rate limits (percent used, reset time in seconds). */
export function toRateLimits(info: ClaudeRateLimit): RateLimits {
  const window = (w: z.infer<typeof Window> | undefined, minutes: number) =>
    w === undefined
      ? undefined
      : {
          usedPercent: Math.round(w.utilization * 1000) / 10,
          windowMinutes: minutes,
          ...(w.resetsAt === undefined ? {} : { resetsAt: w.resetsAt }),
        };
  const primary = window(info.unifiedWindows?.five_hour, 300);
  const secondary = window(info.unifiedWindows?.seven_day, 10_080);
  return { ...(primary ? { primary } : {}), ...(secondary ? { secondary } : {}) };
}

/** Text heuristics for CLI errors that arrive only as a message. */
export function claudeKindFromMessage(message: string): ConsultantErrorKind {
  if (
    /\/login|not logged in|invalid api key|authentication|unauthori[sz]ed|\b401\b|oauth token/i.test(message)
  ) {
    return "unauthenticated";
  }
  if (/usage limit|rate limit|limit reached|\b429\b|overloaded|quota/i.test(message)) return "usage_limit";
  return "process";
}

/** A failed `result` event as a ConsultantError. */
export function resultError(result: ClaudeResult): ConsultantError {
  const text =
    result.result ??
    (result.errors?.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("; ") || result.subtype);
  if (result.api_error_status === 401 || result.api_error_status === 403) {
    return { kind: "unauthenticated", message: text.slice(0, 1000) };
  }
  if (result.api_error_status === 429) return { kind: "usage_limit", message: text.slice(0, 1000) };
  if (result.subtype === "error_max_structured_output_retries") {
    return {
      kind: "schema_failed",
      message: `Claude could not produce output matching the schema: ${text}`.slice(0, 1000),
    };
  }
  return { kind: claudeKindFromMessage(text), message: text.slice(0, 1000) };
}
