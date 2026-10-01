// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors

export const consultantsPackageName = "@ghosthand/consultants" as const;

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
