// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand mcp`: serves MCP on stdio until the client closes stdin (ADR 0006). Nothing else may write
// to stdout while it runs.
import { startStdioServer } from "@ghosthand/mcp";
import { fail } from "../io.ts";

export async function mcpCommand(flags: { interactive: boolean; config?: string }): Promise<number> {
  const started = await startStdioServer({
    interactive: flags.interactive,
    ...(flags.config ? { configPath: flags.config } : {}),
  });
  if (!started.ok) return fail(started.error);
  process.stderr.write(
    `ghosthand mcp: serving on stdio${flags.interactive ? " (observe/act enabled)" : ""}\n`,
  );
  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
    process.stdin.once("close", resolve);
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await started.value.close();
  return 0;
}
