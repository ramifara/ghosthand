// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Command line and environment for the user's own `claude` CLI, verified against Claude Code 2.1.285
// (`claude --help`, 2026-10-01). The consultant only thinks; it never acts on the machine:
// - `--tools ""` disables every built-in tool (with `--json-schema`, the CLI adds only its internal
//   `StructuredOutput` tool, which returns the answer and touches nothing).
// - `--permission-mode dontAsk` denies anything that would prompt instead of asking; we never pass
//   `--dangerously-skip-permissions` or `bypassPermissions`.
// - `--strict-mcp-config` without `--mcp-config` loads no MCP servers; `--setting-sources ""` skips
//   user/project/local settings (hooks, permissions, plugins config).
// - Never `--bare`: it forces API-key auth and would ignore the user's own `claude auth login`.

export type ClaudeEffort = "low" | "medium" | "high";

export interface ClaudeArgsInput {
  readonly system: string;
  readonly model?: string;
  readonly effort?: ClaudeEffort;
  /** JSON Schema for `--json-schema`; the CLI validates and returns `structured_output`. */
  readonly schema?: Record<string, unknown>;
}

/** Flags that must never appear (checked in tests). */
export const FORBIDDEN_CLAUDE_FLAGS = [
  "--bare",
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "bypassPermissions",
] as const;

/** A warm `--print` process that reads user messages as stream-json on stdin. */
export function claudeStreamArgs(input: ClaudeArgsInput): string[] {
  return [
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    // Required by the CLI for stream-json output in print mode.
    "--verbose",
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--system-prompt",
    input.system,
    ...(input.model === undefined ? [] : ["--model", input.model]),
    ...(input.effort === undefined ? [] : ["--effort", input.effort]),
    ...(input.schema === undefined ? [] : ["--json-schema", JSON.stringify(input.schema)]),
  ];
}

/**
 * Variables a parent Claude Code session sets for its own children. Passing them on would make the
 * consultant attach to that session (messaging socket, session id); drop them. The user's config
 * (`CLAUDE_CONFIG_DIR`, `ANTHROPIC_*`) passes through untouched.
 */
export const NESTED_SESSION_ENV = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
] as const;

export function claudeChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const name of NESTED_SESSION_ENV) delete out[name];
  return out;
}
