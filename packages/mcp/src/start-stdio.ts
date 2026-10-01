// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand mcp`: the MCP server on stdio. Local only (ADR 0006): whoever spawns the process is the user.
// stdout carries the protocol, so nothing else may write to it; logs go to the run folders and stderr.

import { openRuntime } from "@ghosthand/engine";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGhosthandMcpServer } from "./create-server.ts";
import { createEngineBackend } from "./engine-backend.ts";

export interface StdioOptions {
  interactive?: boolean;
  configPath?: string;
}

export async function startStdioServer(
  opts: StdioOptions = {},
): Promise<{ ok: true; value: { close(): Promise<void> } } | { ok: false; error: string }> {
  const rt = await openRuntime({
    ...(opts.configPath ? { configPath: opts.configPath } : {}),
    logLevel: "silent",
  });
  if (!rt.ok) return { ok: false, error: rt.error.message };
  const mcp = createGhosthandMcpServer(createEngineBackend(rt.value), {
    interactive: opts.interactive ?? false,
  });
  const transport = new StdioServerTransport();
  await mcp.server.connect(transport);
  return { ok: true, value: { close: () => mcp.close() } };
}
