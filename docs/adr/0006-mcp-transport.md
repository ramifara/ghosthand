<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0006. MCP server: stdio only, no auth layer, job ids for long runs

- Status: proposed
- Date: 2026-10-01

## Context
Phase 5 adds `@ghosthand/mcp` so a coding agent (Claude Code, Codex, any MCP client) can drive GhostHand:
`run_task`, `run_spec`, `get_run`, `get_report`, `list_recipes`, and optionally `observe`/`act`. The plan
leaves "MCP auth" open. A GhostHand run drives a real browser with the user's profiles and secrets, so
whoever can call the tools can act as the user on the web.

## Decision
- **Transport: stdio only.** `ghosthand mcp` speaks MCP over stdin/stdout using the official
  `@modelcontextprotocol/sdk` (MIT). The client spawns the process, so the caller is whoever already runs
  code as the user on this machine. There is no network listener, so there is nothing to authenticate.
- **No HTTP transport yet.** Streamable HTTP would need a listener bound to 127.0.0.1, a per-launch
  bearer token stored 0600 next to the env file, an `Origin` check against DNS rebinding, and a decision on
  remote use over the tailnet (never Funnel). That is deferred until a client needs it; it gets its own ADR.
- **Long runs return at once.** `run_task` and `run_spec` queue a job and return `job-…`; callers poll
  `get_run` (or pass `wait_ms` up to 120 s). Progress lines also go out as `notifications/message`
  logging notifications. Jobs run one at a time, because they share one browser profile (`mcp`) and,
  on the testbed, one database.
- **Same safety as the CLI.** Runs go through `runAgent`/`runQaSpecFile`: recorded, redacted, origin
  allowlists, effect gates, oracles decide. MCP runs use Jev only (no planner or writer), and there is no
  interactive approval prompt: a commit the plan does not pre-approve is refused. `act` types secrets
  by name (`secret: "NAME"`), never by value, and is only registered with `ghosthand mcp --interactive`.
- **Recipes.** `list_recipes` returns an empty list until Phase 3 knowledge exists.

## Consequences
- Configuring a client is one line (`command: ghosthand mcp`). No token handling, no open port.
- Tools cannot be shared between machines or users until the HTTP transport lands.
- Job state lives in memory; a restarted server forgets job ids, but every run stays in the run index,
  and `get_run` accepts run ids too.
