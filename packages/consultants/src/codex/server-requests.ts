// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Answers server-to-client requests from codex app-server. A consultant only reads and answers, so every
// approval, elicitation and tool call is declined. Nothing is ever approved on the user's behalf, and the
// thread runs with `sandbox: "read-only"` and `approvalPolicy: "never"`, so such requests should not occur.
import { METHOD_NOT_FOUND, type ServerRequestReply } from "./json-rpc-client.ts";

const reason = "GhostHand consultants are read-only; declined.";

export function declineServerRequest(method: string): ServerRequestReply {
  switch (method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { result: { decision: "decline" } };
    case "execCommandApproval":
    case "applyPatchApproval":
      return { result: { decision: { denied: { rejection: reason } } } };
    case "mcpServer/elicitation/request":
      return { result: { action: "decline", content: null, _meta: null } };
    default:
      // Includes item/permissions/requestApproval, item/tool/requestUserInput, item/tool/call,
      // account/chatgptAuthTokens/refresh (GhostHand never handles Codex tokens) and attestation/generate.
      return { error: { code: METHOD_NOT_FOUND, message: `${method}: ${reason}` } };
  }
}
