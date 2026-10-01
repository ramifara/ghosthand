# Codex consultant probe (P0-05, 2026-10-01)

Machine: outpostone (CachyOS, x86_64), Node 26.4.0, codex-cli 0.159.2 at `~/.local/bin/codex`, signed in with ChatGPT (plan `pro`). GhostHand read no Codex credentials. Codex used its own login, and GhostHand only called `account/read` and `codex login status`.

Command: `bun run probe:codex --transport both --runs 3` (then `node scripts/probe-codex.ts --runs 3 --model gpt-6.1-sol`). Input: `scripts/__fixtures__/profile-page.png` (960×520 screenshot of a profile settings form, rendered with headless Chrome from `profile-page.html`). Task: "Change the display name to 'Dana Smith-Lee' and save the profile." The model had to return exactly 3 subgoals `{id, title, done_when}` under a strict `outputSchema` (`minItems`/`maxItems` 3, `additionalProperties: false`). Effort `low`.

## Results

| | app-server, thread default model (`gpt-5.6-sol`) | app-server, `gpt-6.1-sol` | exec (`gpt-5.6-sol`) |
|---|---|---|---|
| spawn → `initialize` answered | 214–267 ms | 229–267 ms | n/a (process per ask) |
| `probe()` (spawn, initialize, account/read, model/list, rateLimits/read, close) | 1.1–2.1 s | 1.1 s | 0.2 s (`--version` + `login status`) |
| `open()` (spawn, initialize, account/read, thread/start) | 720 ms (thread/start 97 ms) | 655 ms (thread/start 96 ms) | 157 ms (`login status`) |
| turn latency, 3 turns | 5.9 s, 4.1 s, 5.3 s | 9.9 s, 6.3 s, 7.9 s | 7.7 s, 11.0 s, 6.6 s |
| median turn | **5.3 s** | **7.9 s** | **7.7 s** |
| schema-valid answers | 3/3 | 3/3 | 3/3 |
| `close()` | 57 ms | 57 ms | 0 ms |

Turn latency is from sending `turn/start` to `turn/completed`. Codex's own `turn.durationMs` was within 15 ms of it. All 9 plans were sensible: locate or focus the Display name field, set it to exactly "Dana Smith-Lee", then click Save changes and confirm. They read the current value ("Dana Smith") off the screenshot.

Account and limits (from `account/read` and `account/rateLimits/read`): auth `chatgpt`, plan `pro`, `ordinaryUsageAllowed: true`, a single `codex` bucket with a primary window of 10080 min (weekly) at 40% used. The bucket has no secondary window. 15 small turns did not move `usedPercent`.

Models from `model/list` (visible, default first): `gpt-6.1-sol` (default), `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`. All accept `text` and `image`. Reasoning efforts: `low`, `medium`, `high`, `xhigh`, `max`, plus `ultra` on most models.

## Protocol facts verified on 0.159.2

- Framing: one JSON object per line on stdin/stdout. Messages carry **no `"jsonrpc": "2.0"` member** in either direction. Request ids are integers we choose. Notifications also carry a top-level `emittedAtMs`.
- `initialize {clientInfo:{name,title,version}, capabilities:{experimentalApi, requestAttestation}}` → `{userAgent:"ghosthand/0.159.2 (...)", codexHome, platformFamily, platformOs}`. The version is parsed from `userAgent`. `capabilities` requires `requestAttestation` in the generated types. Then send the `initialized` notification.
- `account/read {refreshToken:false}` → `{account:{type:"chatgpt", email, planType} | {type:"apiKey"} | null, requiresOpenaiAuth, workspaceRouting}`. GhostHand parses `type` and `planType` only and drops the email and account ids. Signed out (empty `CODEX_HOME`): `account: null, requiresOpenaiAuth: true`, and `account/rateLimits/read` returns JSON-RPC error `-32600 "codex account authentication required to read rate limits"`.
- `account/rateLimits/read` (no params) → `{ordinaryUsageAllowed, rateLimits:{limitId, primary:{usedPercent, windowDurationMins, resetsAt}, secondary, credits, planType, rateLimitReachedType}, rateLimitsByLimitId, rateLimitResetCredits, accountId, rateLimitUpsell}`. The notes listed the top-level keys correctly. The window field is `windowDurationMins`.
- `thread/start {ephemeral:true, sandbox:"read-only", approvalPolicy:"never", cwd, developerInstructions, model?}` returns `sandbox:{type:"readOnly", networkAccess:false}`. Without `model`, the thread uses the user's `~/.codex/config.toml` model (`gpt-5.6-sol` here), not the `model/list` default. The thread also loads `~/.codex/AGENTS.md` (listed in `instructionSources`). GhostHand uses a fresh temp dir as `cwd` so no repo `AGENTS.md` is pulled in.
- `turn/start` text input needs `text_elements: []` (`{type:"text", text, text_elements}`). `{type:"localImage", path}` works as noted. `outputSchema`, `effort`, `approvalPolicy` and `sandboxPolicy:{type:"readOnly", networkAccess:false}` are accepted per turn.
- The response to `turn/start` is `{turn:{id, status:"inProgress", ...}}`. Notifications follow: `turn/started`, `item/started`/`item/completed` (userMessage, reasoning, agentMessage), `item/agentMessage/delta`, `thread/tokenUsage/updated`, `account/rateLimits/updated`, `turn/completed {threadId, turn:{status, items, error, durationMs}}`. The final answer is the `agentMessage` item with `phase:"final_answer"`, and `turn/completed.turn.items` repeats it.
- `turn/interrupt {threadId, turnId}` → `{}`, and the turn ends with `turn/completed` status `interrupted` (306 ms after start in the live test).
- Turn errors: `error {error:{message, codexErrorInfo, additionalDetails}, willRetry, threadId, turnId}`. `codexErrorInfo` is a string tag (`usageLimitExceeded`, `unauthorized`, ...) or a single-key object with `httpStatusCode`.
- Server→client requests in this version: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `item/tool/call`, `mcpServer/elicitation/request`, `account/chatgptAuthTokens/refresh`, `attestation/generate`, and legacy `execCommandApproval` / `applyPatchApproval`. GhostHand declines them all (`decline`, `denied`, or a JSON-RPC error). None arrived during the probe.
- `codex exec --json` emits `thread.started`, `turn.started`, `item.completed` (`agent_message`), `turn.completed {usage}`. Failures emit `error {message}` (retries) and `turn.failed {error:{message}}`, then exit code 1. Signed out, it retries 401s for about 15 s before failing. The consultant runs `codex login status` first so it fails fast. `-i/--image` takes several values, so the `-` (prompt from stdin) positional must come before it.

## Takeaways

- app-server with a warm thread is the faster path (median 5.3 s vs 7.7 s for exec on the same model), and only app-server gives plan, model list and rate limits. Keep exec as the fallback.
- Pass `model` explicitly. Otherwise the thread silently follows the user's Codex config.
- A Codex planning turn takes 4–10 s at `low` effort. That suits a planner called once per task or subgoal, not the per-step loop.
