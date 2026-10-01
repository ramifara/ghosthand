// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Zod schemas for the subset of the Codex app-server protocol GhostHand uses. Field names were checked against
// `codex app-server generate-ts` from codex-cli 0.159.2. Unknown fields are stripped, so newer servers that add
// fields keep working.
import { z } from "zod";

export const InitializeResult = z.object({
  userAgent: z.string(),
  codexHome: z.string().optional(),
  platformOs: z.string().optional(),
});
export type InitializeResult = z.infer<typeof InitializeResult>;

export const CodexAccount = z.union([
  z.object({ type: z.literal("chatgpt"), planType: z.string().nullish() }),
  z.object({ type: z.literal("apiKey") }),
  z.object({ type: z.string() }),
]);
export type CodexAccount = z.infer<typeof CodexAccount>;

/** `account/read`. The response also carries `email`; we never keep it. */
export const AccountReadResult = z.object({
  account: CodexAccount.nullable(),
  requiresOpenaiAuth: z.boolean(),
});
export type AccountReadResult = z.infer<typeof AccountReadResult>;

export const CodexModel = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string().optional(),
  hidden: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  inputModalities: z.array(z.string()).optional(),
  defaultReasoningEffort: z.string().nullish(),
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })).optional(),
});
export type CodexModel = z.infer<typeof CodexModel>;

export const ModelListResult = z.object({
  data: z.array(CodexModel),
  nextCursor: z.string().nullish(),
});
export type ModelListResult = z.infer<typeof ModelListResult>;

export const CodexRateLimitWindow = z.object({
  usedPercent: z.number(),
  windowDurationMins: z.number().nullish(),
  resetsAt: z.number().nullish(),
});

export const CodexRateLimitSnapshot = z.object({
  limitId: z.string().nullish(),
  primary: CodexRateLimitWindow.nullish(),
  secondary: CodexRateLimitWindow.nullish(),
  planType: z.string().nullish(),
  rateLimitReachedType: z.string().nullish(),
});
export type CodexRateLimitSnapshot = z.infer<typeof CodexRateLimitSnapshot>;

/** `account/rateLimits/read`. `accountId` and reset-credit ids are deliberately not parsed. */
export const RateLimitsReadResult = z.object({
  ordinaryUsageAllowed: z.boolean().nullish(),
  rateLimits: CodexRateLimitSnapshot,
});
export type RateLimitsReadResult = z.infer<typeof RateLimitsReadResult>;

export const ThreadStartResult = z.object({
  thread: z.object({ id: z.string() }),
  model: z.string(),
  reasoningEffort: z.string().nullish(),
});
export type ThreadStartResult = z.infer<typeof ThreadStartResult>;

export const TurnError = z.object({
  message: z.string(),
  codexErrorInfo: z.unknown().optional(),
  additionalDetails: z.string().nullish(),
});
export type TurnError = z.infer<typeof TurnError>;

export const ThreadItem = z.object({
  type: z.string(),
  id: z.string(),
  text: z.string().optional(),
  phase: z.string().nullish(),
});
export type ThreadItem = z.infer<typeof ThreadItem>;

export const Turn = z.object({
  id: z.string(),
  status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
  items: z.array(ThreadItem).optional(),
  error: TurnError.nullish(),
  durationMs: z.number().nullish(),
});
export type Turn = z.infer<typeof Turn>;

export const TurnStartResult = z.object({ turn: Turn });

export const ItemCompletedParams = z.object({ item: ThreadItem, threadId: z.string(), turnId: z.string() });
export const TurnCompletedParams = z.object({ threadId: z.string(), turn: Turn });
export const ErrorNotificationParams = z.object({
  error: TurnError,
  willRetry: z.boolean(),
  threadId: z.string(),
  turnId: z.string(),
});

export const EmptyResult = z.unknown();
