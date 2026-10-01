// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { parseAnswer } from "./answer.ts";
import { spawnFailure } from "./child-process.ts";
import { fromRpcFailure, fromTurnError, kindFromCodexErrorInfo, kindFromMessage } from "./errors.ts";
import { declineServerRequest } from "./server-requests.ts";

describe("error mapping", () => {
  it.each([
    ["usageLimitExceeded", "usage_limit"],
    ["rateLimitExceeded", "usage_limit"],
    ["sessionBudgetExceeded", "usage_limit"],
    ["unauthorized", "unauthenticated"],
    ["serverOverloaded", "process"],
    [{ httpConnectionFailed: { httpStatusCode: 401 } }, "unauthenticated"],
    [{ responseStreamConnectionFailed: { httpStatusCode: 429 } }, "usage_limit"],
    [{ responseStreamDisconnected: { httpStatusCode: 500 } }, "process"],
    [null, "process"],
  ])("codexErrorInfo %j → %s", (info, kind) => {
    expect(kindFromCodexErrorInfo(info)).toBe(kind);
  });

  it("falls back to the message when codexErrorInfo is missing or generic", () => {
    expect(fromTurnError({ message: "unexpected status 401 Unauthorized", codexErrorInfo: null }).kind).toBe(
      "unauthenticated",
    );
    expect(fromTurnError({ message: "You've hit your usage limit", codexErrorInfo: "other" }).kind).toBe(
      "usage_limit",
    );
    expect(kindFromMessage("stream disconnected")).toBe("process");
  });

  it("maps JSON-RPC failures", () => {
    expect(fromRpcFailure({ kind: "timeout", method: "m", message: "t" }).kind).toBe("timeout");
    expect(fromRpcFailure({ kind: "cancelled", method: "m", message: "c" }).kind).toBe("cancelled");
    expect(fromRpcFailure({ kind: "closed", method: "m", message: "exit" }).kind).toBe("process");
    expect(
      fromRpcFailure({ kind: "rpc", method: "m", code: -32600, message: "authentication required" }).kind,
    ).toBe("unauthenticated");
  });

  it("maps a missing binary to not_installed", () => {
    const e = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
    expect(spawnFailure("codex", e).kind).toBe("not_installed");
    expect(spawnFailure("codex", new Error("weird")).kind).toBe("process");
  });
});

describe("parseAnswer", () => {
  const parse = (v: unknown): { n: number } => {
    if (typeof v === "object" && v !== null && typeof Reflect.get(v, "n") === "number")
      return v as { n: number };
    throw new Error("n must be a number");
  };

  it("parses JSON and runs the caller's validator", () => {
    expect(parseAnswer('{"n":1}', parse)).toEqual({ ok: true, value: { n: 1 } });
    expect(parseAnswer('```json\n{"n":2}\n```', parse)).toEqual({ ok: true, value: { n: 2 } });
  });

  it("returns schema_failed for missing, non-JSON and invalid answers", () => {
    expect(parseAnswer(undefined, parse)).toMatchObject({ ok: false, error: { kind: "schema_failed" } });
    expect(parseAnswer("sure! here", parse)).toMatchObject({ ok: false, error: { kind: "schema_failed" } });
    expect(parseAnswer('{"n":"x"}', parse)).toMatchObject({
      ok: false,
      error: { kind: "schema_failed", message: expect.stringContaining("n must be a number") },
    });
  });
});

describe("declineServerRequest", () => {
  it("declines approvals and elicitations and never approves", () => {
    expect(declineServerRequest("item/commandExecution/requestApproval")).toEqual({
      result: { decision: "decline" },
    });
    expect(declineServerRequest("item/fileChange/requestApproval")).toEqual({
      result: { decision: "decline" },
    });
    expect(declineServerRequest("execCommandApproval")).toMatchObject({
      result: { decision: { denied: {} } },
    });
    expect(declineServerRequest("mcpServer/elicitation/request")).toMatchObject({
      result: { action: "decline" },
    });
    for (const m of [
      "item/permissions/requestApproval",
      "account/chatgptAuthTokens/refresh",
      "item/tool/call",
    ]) {
      expect(declineServerRequest(m)).toHaveProperty("error");
    }
  });
});
