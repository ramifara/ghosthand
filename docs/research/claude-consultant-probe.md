<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->
# Claude consultant probe

Run on 2026-10-01 on the development machine (Linux, Claude Code **2.1.285**, signed in with the user's own Claude Max login via `claude auth login`). Two one-line arithmetic turns on `haiku`, no tools, no images. Total reported API-equivalent cost: about $0.004 (drawn from the subscription, not billed per call).

```
node scripts/probe-claude.ts --runs 2 --model haiku
```

## Command line (verified against `claude --help`)

```
claude --print --input-format stream-json --output-format stream-json --verbose \
  --tools "" --permission-mode dontAsk --strict-mcp-config --setting-sources "" \
  --no-session-persistence --system-prompt <system> --model haiku --json-schema <schema>
```

- `--tools ""` is the documented way to disable all built-in tools. The `system/init` event listed `tools: ["StructuredOutput"]` only: `--json-schema` adds the CLI's internal structured-output tool, which returns the answer and does nothing else. No MCP servers (`mcp_servers: []`).
- `--permission-mode dontAsk` is accepted (choices: acceptEdits, auto, bypassPermissions, manual, dontAsk, plan). We never pass `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions` or `bypassPermissions`.
- `--bare` is never used: its help text says it reads only `ANTHROPIC_API_KEY`/`apiKeyHelper` and never OAuth, which would ignore the user's own login.
- `--json-schema` works in stream-json mode and is fixed for the process. The `result` event carries `structured_output` (and the same JSON as a string in `result`). The consultant keeps one warm process per schema.
- `claude auth status` prints JSON by default (`--json`, `--text` exist). Fields seen: `loggedIn`, `authMethod` ("claude.ai"), `apiProvider` ("firstParty"), `subscriptionType` ("max"), plus email, org id/name and directories, which GhostHand drops.
- When run from inside a Claude Code session, the child inherits `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET` and similar variables and attaches to the parent's messaging socket. The consultant strips these (`NESTED_SESSION_ENV`) and keeps `CLAUDE_CONFIG_DIR` and `ANTHROPIC_*`.

## Latency

| Step | ms |
|---|---|
| `probe()` (`--version` + `auth status`) | 587 |
| `open()` (auth status check, temp dir) | 318 |
| Ask 1, cold: spawn → `system/init` | 958 |
| Ask 1, cold: message → `result` (wall) | 2,847 |
| Ask 1, CLI `duration_ms` | 1,923 |
| Ask 2, warm: message → `result` (wall) | 1,664 |
| Ask 2, CLI `duration_ms` | 1,659 |

An earlier hand-run turn with the same flags reported `ttft_ms` 1,695 and `duration_ms` 1,973 for a cold call. A warm process saves about 1.2 s per ask (process start and CLI init). Both answers were correct and matched the schema.

## Stream events used

- `{"type":"system","subtype":"init", model, tools, claude_code_version, permissionMode, apiKeySource:"none", …}`
- `{"type":"rate_limit_event","rate_limit_info":{status:"allowed", rateLimitType:"five_hour", unifiedWindows:{five_hour:{utilization,resetsAt}, seven_day:{…}}}}` → `rateLimits()` (55% / 20% used at the time of the probe).
- `{"type":"result","subtype":"success","is_error":false,"result":"{…}","structured_output":{…},"duration_ms":…,"total_cost_usd":…, "api_error_status":null, …}`. The `type` key is not the first key in this line. `total_cost_usd` is cumulative for the process.
- `assistant` messages carry a `tool_use` block named `StructuredOutput`; the consultant ignores them and reads the `result`.

## Not verified

- Image blocks (`{"type":"image","source":{"type":"base64",…}}`) in stream-json user messages. The shape follows the Messages API and T3 Code's adapter, and is covered by unit tests only.
- Error `result` shapes for usage limits and logged-out sessions; the mapping uses `api_error_status` and message text, tested against a fake CLI.
- `--effort` with `haiku` (not passed in this probe).
