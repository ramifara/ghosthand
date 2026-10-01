# Using the user's installed CLI agents (Codex CLI, Claude Code) as GhostHand consultants

Research date: 2026-10-01. Sources: local T3 Code checkout `/home/outpostone/dev/t3code` (HEAD 986a153, 2026-07-11), installed CLIs on this box (Claude Code 2.1.285, codex-cli 0.159.2, opencode present, gemini absent), and the web.
Legend: **[V]** verified from source code, primary docs, or a local run. **[S]** secondary/press. **[U]** unverified or inferred.

Companion note: `codex-subscription.md` (SIWC, app-server details, OpenAI terms). This file doesn't repeat it.

---

## 1. How T3 Code integrates providers [V]

License: **MIT** (`/home/outpostone/dev/t3code/LICENSE`, "Copyright (c) 2026 T3 Tools Inc."). We can copy code into an AGPL project if we keep the MIT notice.

README model: "Install and authenticate at least one provider before use". The user runs `codex login`, `claude auth login`, `cursor-agent login`, or `opencode auth login` themselves. T3 never sees a token. It points at a binary path (`settings.ts`: `makeBinaryPathSetting("claude")` / `("codex")`) and an optional home override (`HOME` for Claude, `CODEX_HOME` for Codex).

Provider code: `apps/server/src/provider/{Drivers,Layers,Services,acp}/`. One-shot structured calls: `apps/server/src/textGeneration/`.

### 1a. Claude (two paths)

**Interactive sessions use the Agent SDK, which drives the user's own `claude` binary.** See `apps/server/src/provider/Layers/ClaudeAdapter.ts` (3.9k lines). Dependency: `"@anthropic-ai/claude-agent-sdk": "^0.3.170"` (`apps/server/package.json`).

```ts
// ClaudeAdapter.ts ~3443
const queryOptions: ClaudeQueryOptions = {
  cwd, model: apiModelId,
  pathToClaudeCodeExecutable: claudeBinaryPath,          // user's installed binary
  systemPrompt: { type: "preset", preset: "claude_code" },
  settingSources: ["user","project","local"],
  effort, permissionMode,                                  // acceptEdits | bypassPermissions (+allowDangerouslySkipPermissions)
  settings: { alwaysThinkingEnabled, fastMode, ultracode },
  resume: existingResumeSessionId, sessionId: newSessionId,
  includePartialMessages: true, canUseTool, env: claudeEnvironment,
  additionalDirectories: [cwd], extraArgs, mcpServers: { "t3-code": { type: "http", url, headers } },
};
query({ prompt: AsyncIterable<SDKUserMessage>, options })   // ~1364: streaming input keeps one warm process per thread
```

- **Warm session.** `prompt` is an AsyncIterable queue, so each new turn is pushed into the same live process.
- **Resume.** A resume cursor `{resume: sessionId, resumeSessionAt: lastAssistantUuid}` is persisted (`readClaudeResumeState` ~562).
- **Cancel.** `context.query.interrupt()` (~3748). Stop interrupts the stream fiber.
- **Approvals.** `canUseTool` callback (~3250). This also handles `AskUserQuestion` and `ExitPlanMode`.
- **Images.** Base64 `{type:"image", source:{type:"base64", media_type, data}}` content blocks for gif/jpeg/png/webp (~883-962). Other attachment types are rejected.
- **Rate limits.** `rate_limit_event` SDK messages are mapped to `account.rate-limits.updated` (~2836).

**Detection and auth.** See `apps/server/src/provider/Layers/ClaudeProvider.ts`.
1. Run `claude --version`.
2. Gate models by version. The model list is a **hardcoded catalog** (`BUILT_IN_MODELS`, `getBuiltInClaudeModelsForVersion`; Fable 5 / Opus 4.8 / 4.7 need minimum CLI versions).
3. Probe auth with a trick (~571). Start `query()` with a never-yielding prompt, `persistSession:false`, `allowedTools:[]`, and await `q.initializationResult()`. That returns `account.{email, subscriptionType, tokenSource}` and slash commands without any API request. Then abort.
4. `claude auth status` is the documented fallback. Locally it prints JSON: `{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max",...}` [V local].

**One-shot structured JSON** (commit messages, titles). See `apps/server/src/textGeneration/ClaudeTextGeneration.ts:160`.

```ts
[claudeBin, "-p", "--output-format","json", "--json-schema", jsonSchemaStr, "--model", id,
 "--effort", e?, "--settings", json?, "--dangerously-skip-permissions"]   // prompt via stdin
// parse stdout envelope, take .structured_output, Schema-decode; 180 s timeout; non-zero exit -> error with stderr
```

This path sends no images. `--dangerously-skip-permissions` is acceptable for T3's git helpers but wrong for us; see section 4.

### 1b. Codex (two paths)

**Interactive sessions use `codex app-server` (JSON-RPC over stdio).** See `apps/server/src/provider/Layers/CodexSessionRuntime.ts` (spawn ~722: `[binaryPath, "app-server", ...appServerArgs]`, `CODEX_HOME` env). The typed client is generated from the protocol: `packages/effect-codex-app-server` (`scripts/generate.ts`, `_generated/schema.gen.ts`). It is an MIT-licensed Effect package, and we could port it to plain TS.

The call sequence:
1. `initialize {clientInfo:{name:"t3code_desktop", title, version}, capabilities:{experimentalApi:true}}`, then the `initialized` notification.
2. `thread/start` or `thread/resume`. It falls back to a fresh start if the thread isn't found (~460-476).
3. `turn/start {threadId, input:[{type:"text"},{type:"image",url}|localImage], approvalPolicy, sandboxPolicy, model, effort, serviceTier, collaborationMode}`.
4. `turn/interrupt` cancels.

Runtime mode mapping (~265-320):

| Mode | approvalPolicy | sandbox |
|---|---|---|
| approval-required | untrusted | read-only (`{type:"readOnly"}`) |
| auto-accept-edits | on-request | workspace-write |
| full-access | never | danger-full-access |

`account/rateLimits/updated` notifications are forwarded (`CodexAdapter.ts:1119`).

**Detection, auth, and models.** See `apps/server/src/provider/Layers/CodexProvider.ts:300-470`. It spawns `app-server`, calls `initialize` (the version is parsed from `userAgent`), then `account/read`. If `!account && requiresOpenaiAuth`, it reports "Run `codex login`". Otherwise it calls `model/list` (paginated, **live list**) and `skills/list`. `account.planType` is mapped to labels (plus, pro, prolite, team, ...).

**One-shot structured JSON.** See `apps/server/src/textGeneration/CodexTextGeneration.ts:182`.

```
codex exec --ephemeral --skip-git-repo-check -s read-only --model M --config model_reasoning_effort="low"
           [--config service_tier=...] --output-schema <tmp.json> --output-last-message <tmp.out> [--image p]... -
```

The prompt goes in on stdin. The schema is written to a temp file, and the result is read from the last-message file. 180 s timeout. **Image attachments are supported here.**

### 1c. Others
- **Cursor:** `cursor-agent acp` (Agent Client Protocol). `acp/CursorAcpSupport.ts`.
- **Grok:** `grok agent stdio` (ACP). `acp/GrokAcpSupport.ts`. The shared ACP client lives in `packages/effect-acp`.
- **OpenCode:** `opencode serve --hostname --port` plus its HTTP API. `provider/opencodeRuntime.ts:342`.
- **ACP as the generic adapter.** Any future agent that speaks ACP (Gemini CLI has `--experimental-acp` [U current flag]) can share one adapter.

---

## 2. Anthropic policy (state as of 2026-10-01)

**Primary text.** https://code.claude.com/docs/en/legal-and-compliance [V, fetched today].

> "**OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."

> "**Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication ... Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."

> "... Nor does it prevent an end user from signing in to the **unmodified Claude Code binary with their own Claude subscription**, including where a platform hosts Claude Code ..."

> "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." / "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."

The same page has a section, "Can customers offer Claude Code in their products?" Its conditions:
- The binary must not be modified, and no auth method may be removed.
- No paying for, reselling, or intermediating usage. Each end user authenticates with their own key or subscription.
- That section is framed under the Commercial Terms.

The Agent SDK overview (https://code.claude.com/docs/en/agent-sdk/overview) [V] says:

> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."

Branding rules from the same page:
- Allowed: "Claude Agent", or "{Name} Powered by Claude".
- Not allowed: "Claude Code" as our feature name, or Claude Code-like visuals.
- SDK use is governed by the Commercial Terms.

The support article https://support.claude.com/en/articles/15036540 [V] says: "we're pausing the changes ... For now, nothing has changed: Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits." Its (paused) credit plan explicitly covered "Third-party apps that authenticate with your Claude subscription through the Agent SDK". So Anthropic acknowledges this category exists.

Timeline [S]:

| Date | Event |
|---|---|
| Feb 2026 | ToS bans subscription OAuth in third-party apps |
| 2026-04-04 | Enforcement. OpenClaw, OpenCode and other harnesses that used subscription tokens directly lose access. Boris Cherny announcement. |
| ~Apr 2026 | Theo: "T3 Code confirmed SAFE FOR CLAUDE SUBS ... explicit confirmation that tools wrapping Claude Code for local use are allowed" (https://x.com/theo/status/2040221237503561780; the underlying Anthropic statement was not retrievable, X returned 402) |
| 2026-05-13 | Anthropic announces that from 06-15, Agent SDK / `claude -p` / third-party apps (named in press: OpenClaw, T3 Code, Conductor, Zed, Jean) would move to a separate monthly credit (Pro $20 / Max5x $100 / Max20x $200) |
| 2026-06-15/16 | That change is **paused**. Still paused as of the support article. |

Press for the timeline: https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch, https://thenewstack.io/anthropic-pauses-claude-agent-sdk-subscription-change/, https://zed.dev/blog/anthropic-subscription-changes

**Is "a free pass for T3 Code" real?** It is not a named exemption. T3 Code complies with the written rule:
- The user installs the **unmodified** `claude` binary and signs in through Anthropic's own flow.
- T3 spawns that binary (via the Agent SDK `pathToClaudeCodeExecutable`, or `claude -p`) on the user's own machine.
- T3 never reads or stores tokens, does not offer "Sign in with Claude", and does not bill or intermediate.

That matches the "end user signs in to the unmodified Claude Code binary with their own subscription" carve-out. OpenCode/OpenClaw were blocked because they extracted the OAuth token and called the API directly.

**Unresolved tension [U].** The developer paragraph says Agent SDK products "should use API key authentication", while the carve-out and the support article tolerate subscription-backed third-party SDK apps. Anthropic has not published a definitive allowlist. Usage also draws on the user's limits under "ordinary, individual usage" language, and Anthropic says a billing change will come "with advance notice".

**GhostHand stance.**
- Spawn only the user's installed binary. Never touch `~/.claude` credentials.
- No in-app Claude login. Show "Run `claude auth login` in a terminal".
- Label it "Claude (via your Claude Code install)" and avoid Claude Code branding.
- Call it rarely (consultant, not per-step).
- Make it opt-in, with an API key as the recommended Anthropic path.
- Check the terms again before each release.

**AGPL wrinkle [U].** `@anthropic-ai/claude-agent-sdk` is proprietary (Commercial Terms, not OSS). For an AGPL app it is cleaner to speak the CLI's `--input-format stream-json --output-format stream-json` protocol directly against the user's `claude` binary (that is what the SDK does), or to make the SDK an optional, separately installed dependency. Get a lawyer's read if it matters.

---

## 3. OpenAI stance on driving the user's Codex CLI with a ChatGPT login

- **Codex CLI is Apache-2.0**, which is compatible with AGPLv3.
- **App-server docs** (https://learn.chatgpt.com/docs/app-server) [V]: app-server is for "deep integration inside your own product". IDE extensions and third-party clients set `clientInfo.name`. "If you are developing a new Codex integration intended for enterprise use, please contact OpenAI to get it added to a known clients list." For automation/CI they recommend the Codex SDK (`@openai/codex-sdk`, which wraps `codex exec`).
- **No written prohibition** on a local app spawning the user's own `codex` with the user's own `codex login`. Many tools do it openly: T3 Code, Zed via ACP, the Vercel AI SDK community provider, OpenClaw.
- **SIWC (DevDay 2026-09-29) is now the sanctioned third-party plan-usage path.** Its app-server page shows running `codex app-server` with an SIWC `ACCESS_TOKEN` and `requires_openai_auth=false`. Open-source apps qualify, and T3 is a launch partner. See `codex-subscription.md` section 0/1a.
- App-server also accepts `account/login/start` with `{type:"chatgpt"|"chatgptDeviceCode"|"apiKey"|"chatgptAuthTokens"}` (`schema.gen.ts:34162`).
- **Practical stance:** reuse the user's existing `codex login` through their binary, as T3 does, and offer SIWC as the first-class login for an AGPL app. Never call `chatgpt.com/backend-api` ourselves. Set `clientInfo.name:"ghosthand"`.

---

## 4. Practical capabilities for a consultant

| | Claude Code | Codex |
|---|---|---|
| One-shot JSON | `claude -p --output-format json --json-schema '<schema>'` returns envelope `.structured_output`. SDK: `outputFormat:{type:"json_schema",schema}`, result `structured_output`; failure subtype `error_max_structured_output_retries`; also treat success-without-output as failure. JSON Schema draft-07. [V docs] | `codex exec --ephemeral --skip-git-repo-check -s read-only --output-schema f.json -o out.txt -i shot.png -` (`--json` for JSONL events) [V help] |
| Images | SDK/stream-json: base64 image content blocks in the user message (T3 does this). `-p` text mode has no image flag [U: `@path` reading would need the Read tool]. | `-i/--image FILE` (exec); `{type:"localImage", path}` or `{type:"image", url}` in `turn/start` [V] |
| Warm session | SDK `query()` with an AsyncIterable prompt, or `claude -p --input-format stream-json --output-format stream-json` kept open; push one user message per ask. `resume` / `sessionId` / `persistSession:false` / `--no-session-persistence`. | One `codex app-server` process; `thread/start {ephemeral:true, sandbox:"read-only", approvalPolicy:"never", baseInstructions/developerInstructions}`; per-turn **`outputSchema`**, `effort`, `model` on `turn/start` [V schema] |
| Read-only / no tools | `tools: []` / `--tools ""` (no tools at all), `permissionMode:"dontAsk"`, `--strict-mcp-config`, `settingSources: []` or `--setting-sources ""`, own `systemPrompt`. `--restricted` drops code-running tools. **Do not use `--bare`: it forces API-key auth and never reads OAuth** [V help]. Keep `cwd` in an empty temp dir. | `sandbox:"read-only"` + `approvalPolicy:"never"` (no escalation); `--ignore-user-config`/`--ignore-rules` on exec; empty temp `cwd`. A prompt-only consultant shouldn't need shell; deny via sandbox [U whether a tool-less mode exists] |
| Auth check | `claude auth status` (JSON) or SDK `initializationResult().account` (no API call) | app-server `account/read` → `{account:{type:"chatgpt", planType:"pro"}, requiresOpenaiAuth}` |
| Models | Hardcoded/version-gated in T3; SDK `supportedModels()` [U] | `model/list` (live). Local run: gpt-6.1-sol, gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol/terra/luna, gpt-5.5 |
| Limits / errors | `rate_limit_event` stream messages; result `is_error`; non-zero exit + stderr | `account/rateLimits/read` (`ordinaryUsageAllowed, rateLimits, rateLimitsByLimitId, rateLimitResetCredits`); turn error `codexErrorInfo` ∈ `usageLimitExceeded, unauthorized, serverOverloaded, contextWindowExceeded, ...` |
| Cancel | `query.interrupt()` / AbortController | `turn/interrupt` (turn ends `status:"interrupted"`) |
| Concurrency | One process per session. Parallel sessions work but all draw from one subscription pool [U throttling] | One app-server can hold multiple threads; concurrent turns per thread are not supported [U]; use several threads |

**Latency, measured locally 2026-10-01 with no model calls:**
- `claude --version` takes about 15 ms and `codex --version` about 55 ms. These are fast paths only.
- `codex app-server`: initialize took 584 ms, and `account/read` came back at 2.5 s (it includes a token check/refresh).
- A full one-shot `claude -p` / `codex exec` adds the CLI's init (settings, MCP, plugins, system prompt) to the model latency. Expect **~2-5 s of overhead per cold call** before the first token [U, not measured to avoid spending the user's quota].
- A warm session avoids the process start and init. With Claude, the CLI's prompt caching also cuts TTFT on repeated system prompts.
- Conclusion: these consultants are for **planning/analysis at task start, on failure, or every N steps**, not for the per-action loop. Jev stays the fast actor.

---

## 5. Proposed `AgentConsultant` adapter

```ts
interface ConsultantProbe { installed: boolean; version?: string; binaryPath: string;
  auth: { status: "authenticated"|"unauthenticated"|"unknown"; kind?: "subscription"|"apiKey"; plan?: string; email?: string };
  models: { id: string; label: string }[]; message?: string }

interface AskInput<T> { prompt: string; system?: string; images?: { mime: "image/png"|"image/jpeg"|"image/webp"; bytes: Uint8Array }[];
  schema: JsonSchema7; parse: (u: unknown) => T; model?: string; effort?: "low"|"medium"|"high"; timeoutMs?: number; signal?: AbortSignal }

type ConsultantError =
  | { kind: "not_installed" } | { kind: "unauthenticated"; hint: string }   // "Run `codex login`" / "Run `claude auth login`"
  | { kind: "usage_limit"; resetAt?: string } | { kind: "timeout" } | { kind: "cancelled" }
  | { kind: "schema_failed"; raw?: string } | { kind: "process"; exitCode?: number; stderr: string };

interface AgentConsultant {
  id: "codex" | "claude";
  probe(): Promise<ConsultantProbe>;                  // detect + auth + models; cache ~5 min
  open(opts: { model?: string; system: string }): Promise<ConsultantSession>;  // warm process
}
interface ConsultantSession {
  ask<T>(i: AskInput<T>): Promise<Result<T, ConsultantError>>;   // serialised per session
  rateLimits(): Promise<unknown>;  interrupt(): Promise<void>;  close(): Promise<void>;
}
```

**Common rules.**
- Resolve the binary from a setting, else `PATH` (`which`). Electron GUI launches on macOS have a thin PATH, so also check `~/.local/bin`, `/opt/homebrew/bin`, and `~/.bun/bin`.
- Spawn with `cwd` set to an empty per-session temp dir and the user's env (plus `CODEX_HOME` / `HOME` overrides if configured).
- Images go to temp PNG files (Codex `localImage`) or base64 blocks (Claude). Downscale screenshots first.
- Parse the result with our own Zod schema even when the CLI already validated it.
- On `usage_limit` or `unauthenticated`, fall back to the next consultant or an API-key model.
- Fall back to one-shot `exec` / `-p` if the warm session dies, and restart lazily.
- Mark the consultant read-only in the UI. It plans; it never acts on the machine.

**Codex implementation (implement first).**
- **probe:** spawn `codex app-server`, then `initialize {clientInfo:{name:"ghosthand"}, capabilities:{experimentalApi:true}}`, `account/read`, `model/list`. Keep the process as the warm session.
- **open:** `thread/start {cwd: tmp, ephemeral:true, sandbox:"read-only", approvalPolicy:"never", model, developerInstructions: system}`.
- **ask:** `turn/start {threadId, input:[{type:"text",text},{type:"localImage",path}...], outputSchema, effort, sandboxPolicy:{type:"readOnly"}}`. Collect `item/completed` agent message text until `turn/completed`, then `JSON.parse` it and validate. Map `codexErrorInfo.usageLimitExceeded` to `usage_limit`.
- Use a new thread per independent question, or reuse one thread when the consultant should remember the task context.
- **one-shot fallback:** the `codex exec` flags from T3 plus `-i`.
- Generate TS types with `codex app-server generate-ts` from a pinned version, or port T3's `effect-codex-app-server` (MIT).

**Claude implementation (second).**
- **probe:** `claude --version`, then `claude auth status` (JSON). Models come from a small built-in list (alias ids such as `sonnet`/`opus` [U alias acceptance in SDK]) plus user custom ids.
- **open:** spawn `claude -p --input-format stream-json --output-format stream-json --verbose --tools "" --permission-mode dontAsk --strict-mcp-config --setting-sources "" --no-session-persistence --system-prompt <system> --model M --json-schema <schema>` [U: `--json-schema` is fixed per process, so open one session per schema, or include the schema in the prompt and validate ourselves], or use the Agent SDK `query()` with the same options plus `pathToClaudeCodeExecutable`.
- **ask:** write `{"type":"user","message":{"role":"user","content":[{type:"text"},{type:"image",source:{type:"base64",...}}]}}` and read until the `result` message. Take `structured_output`. Map `rate_limit_event` and result errors.
- **one-shot fallback:** `claude -p --output-format json --json-schema ... --tools "" --permission-mode dontAsk` (not `--dangerously-skip-permissions`).

**Why Codex first.**
1. Policy footing is clearer: Apache-2.0 CLI, app-server documented for third-party clients, and SIWC launched explicitly for open-source apps. Claude's subscription use is tolerated via the "unmodified binary" carve-out but is still in flux (paused billing change, enforcement "without prior notice").
2. Better technical fit: warm app-server threads with **per-turn `outputSchema`**, first-class `localImage`, a live `model/list`, structured `account/read` / `rateLimits/read`, and typed `usageLimitExceeded` errors.
3. No proprietary SDK dependency for an AGPL codebase.
4. Rami has ChatGPT Pro (local `account/read`: planType "pro") and Claude Max (`claude auth status`: "max"), so both can be tested. Claude is a near-copy once the interface exists, and T3's `ClaudeAdapter.ts` / `ClaudeTextGeneration.ts` show the working option set.
