// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors

export const consultantsPackageName = "@ghosthand/consultants" as const;

export {
  type ClaudeArgsInput,
  type ClaudeEffort,
  claudeChildEnv,
  claudeStreamArgs,
  FORBIDDEN_CLAUDE_FLAGS,
  NESTED_SESSION_ENV,
} from "./claude/claude-args.ts";
export {
  authKind,
  CLAUDE_LOGIN_HINT,
  CLAUDE_MODEL_ALIASES,
  ClaudeAuthStatus,
  ClaudeConsultant,
  type ClaudeConsultantOptions,
  type ClaudeProbeDetail,
  createClaudeConsultant,
} from "./claude/claude-consultant.ts";
export { ClaudeSession, type ClaudeSessionOptions, type ClaudeTurnStats } from "./claude/claude-session.ts";
export type { AccountInfo, RateLimitsDetail } from "./codex/account.ts";
export type { CodexSessionInfo, CodexTurnStats } from "./codex/app-server-session.ts";
export { CodexAppServerSession } from "./codex/app-server-session.ts";
export type { ChildProcessLike, SpawnFn, SpawnOptions } from "./codex/child-process.ts";
export type {
  CodexConsultantOptions,
  CodexProbeDetail,
  CodexSession,
  CodexTransport,
} from "./codex/codex-consultant.ts";
export { CodexConsultant, createCodexConsultant } from "./codex/codex-consultant.ts";
export { CodexExecSession } from "./codex/exec-session.ts";
export type { JsonRpcFailure, RequestOptions, ServerRequestReply } from "./codex/json-rpc-client.ts";
export { JsonRpcClient, LineDecoder } from "./codex/json-rpc-client.ts";
export type {
  ClaudePlanner,
  ClaudePlannerOptions,
  CodexPlanner,
  CodexPlannerOptions,
  ConsultantPlanner,
  ConsultantPlannerOptions,
} from "./consultant-planner.ts";
export {
  createClaudePlanner,
  createCodexPlanner,
  createConsultantPlanner,
  plannerErrorFromConsultant,
} from "./consultant-planner.ts";
