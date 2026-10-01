# Using a ChatGPT/Codex subscription in jevCUA (research, 2026-09-30)

Scope: how a private TypeScript + Electron computer-use agent can use a user's ChatGPT/Codex subscription next to API keys and local models. Web and source research only; nothing installed and no logins or keyed API calls made.

Legend: **[V]** verified from a primary source (OpenAI docs or source code) on 2026-09-30. **[S]** secondary source (press, third-party docs). **[U]** unverified or inferred.

---

## 0. Headline: the landscape changed yesterday

On **2026-09-29 (OpenAI DevDay 2026)**, OpenAI launched **"Sign in with ChatGPT" (SIWC) plan usage**. Third-party apps can now get an OAuth token that bills eligible **Responses API** requests to the user's ChatGPT plan. It goes to the **public** `https://api.openai.com/v1/responses` endpoint, not `chatgpt.com/backend-api`.

- Dev docs: https://developers.openai.com/siwc/token-sharing-open-source [V]
- Quickstart: https://developers.openai.com/siwc/quickstart [V]
- DevDay page: https://learn.chatgpt.com/docs/whats-new/devday-2026 [V]
- Help Center (returned 403 to the fetcher): https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites
- Press: https://runtimewire.com/article/openai-launches-login-with-chatgpt-and-routes-plan-usage-into-third-party-ai-app, https://thenewstack.io/sign-in-with-chatgpt/ [S]
- Open-source launch apps: OpenCode, OpenClaw, Pi (Earendil), T3. Commercial partners: Devin, Notion, Vercel, Amp, Warp, Kilo Code, Conductor, Hermes Agent, and others. [S]

**Eligibility (important for a private app).** The quickstart says: "ChatGPT plan usage is available to all open-source partners and selected private clients." The open-source docs say: "These docs explain ChatGPT plan usage for open-source and locally hosted apps. If you're interested in offering it in a paid or remotely hosted app, complete the interest form" (https://openai.com/form/sign-in-with-chatgpt-interest/). [V]

The docs do not define "open source". They also don't say whether a private, closed-source, locally hosted personal app qualifies. jevCUA is local and unpaid, which fits "locally hosted", but it is private, and "private clients" are "selected". **[U] Status for a private personal app is ambiguous.** The cleanest ways to qualify are to open-source the app or to submit the interest form.

Plans: "eligible ChatGPT Plus and Pro users". Business and Enterprise are not mentioned. [V]

Plus: a 5-hour usage limit shared across all apps. Pro: no per-app weekly restriction. Users can set a weekly per-app share in ChatGPT settings. [V/S]

---

## 1. Officially supported integration paths

### 1a. SIWC plan usage (new, preview), direct Responses API

Source: https://developers.openai.com/siwc/token-sharing-open-source/sign-in [V]

- **Dynamic client registration.** The first sign-in uses `client_id=dynamic_agent_client`. The callback returns an issued `client_id` (`oaiapp_...`). Persist that ID and use it for later sign-ins and refreshes.
- **Authorize:** `https://auth.openai.com/api/accounts/authorize`
  - Parameters: `response_type=code`, `scope=openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`, `state`, `nonce`, `code_challenge_method=S256`, `code_challenge`.
  - Required: `ext_agent_host_id`, a stable opaque host ID. Accepted forms are `urn:ietf:params:oauth:jwk-thumbprint:…` (recommended, RFC 9278), `urn:uuid:<v4>`, or `did:key:`.
  - Optional: `agent_name_hint` (first registration only), `id_token_hint`, `login_hint`.
- **Redirect URI.** HTTP loopback on `127.0.0.1` only ("Do not substitute `localhost`"). The port may vary between attempts; the path must match exactly. The example is `http://127.0.0.1:1455/auth/callback`.
- **Token exchange:** POST form-encoded to `https://auth.openai.com/api/accounts/oauth/token` with `grant_type=authorization_code`, `code`, issued `client_id`, `code_verifier`, `redirect_uri`, `resource`. No client secret (public client).
- **ID token validation.** Check it against OpenAI JWKS: issuer, audience equal to the issued client_id, exp, and nonce. Use `sub` as the identity. Confirm the granted scopes include `chatgpt.tokens.use.direct`.
- **Refresh:** `grant_type=refresh_token` plus issued `client_id`, `refresh_token`, and `resource`, sent to the same token URL. Replace the access token, expiry, and scopes together.
- **Revoke:** POST `token=<refresh>&token_type_hint=refresh_token&client_id=…` to the revocation endpoint. (Codex source uses `https://auth.openai.com/oauth/revoke`; the SIWC revoke URL is [U].)
- **Storage guidance.** Keep one record per account with owner-only permissions (0600): sub, client_id, access, refresh, id_token, expiry, scopes, and host id.

**Inference.** Source: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference [V]

- `POST https://api.openai.com/v1/responses` with `Authorization: Bearer <access_token>`.
- Must send `store:false` and `stream:true`. `input` must be an array. Use `instructions` or developer messages; system-role messages are rejected.
- Model catalog: `GET https://api.openai.com/v1/models` with the same token. Filter `visibility:"list"`, show `display_name`, send `slug`.
- Explicit rule: **"do not point it at ChatGPT's `backend-api` endpoints."**
- Streams can fail mid-flight with `response.failed` / `subscription_sharing_usage_limit_exceeded`. Treat only `response.completed` as success.

**Preview limitations.** Source: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations [V]

- Supported: "Text, images, and files are supported when the selected model accepts them." Function and custom tools are supported (in namespaces or through `additional_tools` input items).
- Not supported:
  - Image generation, file search, Code Interpreter, and **native computer use** (so no hosted `computer_use` tool).
  - Hosted MCP/connectors and `tool_search`.
  - Audio/video input and the Files API.
  - `previous_response_id` over HTTP.
  - WebSockets (`supports_websockets=false`).
- Rejected parameters: `background`, `conversation`, `max_output_tokens`, `max_tool_calls`, `metadata`, `moderation`, `multi_agent`, `prompt`, `prompt_cache_retention`, `safety_identifier`, `temperature`, `top_logprobs`, `top_p`, `truncation`, `user`.
- Consequence for jevCUA: send screenshots as `input_image` and define our own function tools (click, type, scroll, and so on). That is the standard "custom CUA over a vision model" pattern. The history must be resent every step (store:false, no previous_response_id), so plan for context and screenshot pruning.

**UI/UX rules.** Source: https://developers.openai.com/siwc/ui-ux-guidelines [V]

- The sign-in button reads "Continue with ChatGPT" with the ChatGPT logo.
- Show a first-run modal saying eligible AI requests will use the user's ChatGPT plan.
- Show "Using ChatGPT plan" near the composer.
- Provide a "Manage usage" link, and make it the primary action when the limit is hit.

**Codex app-server with a SIWC token.** Source: https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server [V]

```
codex app-server --listen stdio:// \
  -c 'model_provider="openai_chatgpt_plan"' \
  -c 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"' \
  -c 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"' \
  -c 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"' \
  -c 'model_providers.openai_chatgpt_plan.wire_api="responses"' \
  -c 'model_providers.openai_chatgpt_plan.requires_openai_auth=false' \
  -c 'model_providers.openai_chatgpt_plan.supports_websockets=false'
```

On token refresh, restart app-server with the new `ACCESS_TOKEN` and call `thread/resume`. Also pass `clientInfo.name` equal to `agent_name_hint`.

### 1b. `codex app-server` (JSON-RPC 2.0, used by the VS Code extension and the Codex app)

Docs: https://learn.chatgpt.com/docs/app-server (moved from developers.openai.com/codex/app-server). Protocol source: https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/src/protocol [V]

**Transport.** stdio JSONL (default, `--listen stdio://`), a Unix socket, or `ws://` (experimental, "unsupported"). Send `initialize` once, then the `initialized` notification.

**Schemas.** `codex app-server generate-ts --out ./schemas` and `generate-json-schema` produce version-matched types. Pin the codex version and generate types at build time.

**Auth (`v2/account.rs`)** [V]:

- `account/login/start`:
  - `{type:"apiKey", apiKey}`
  - `{type:"chatgpt", appBrand?, codexStreamlinedLogin?, useHostedLoginSuccessPage?}` returns `{type:"chatgpt", loginId, authUrl}`. The embedding app opens `authUrl` in the system browser. Codex runs its own localhost callback server (default port **1455**, issuer `https://auth.openai.com`) and emits `account/login/completed {loginId, success, error}`, then `account/updated`.
  - `{type:"chatgptDeviceCode"}` returns `{loginId, verificationUrl, userCode}`.
  - `{type:"chatgptAuthTokens", accessToken, chatgptAccountId, chatgptPlanType?}` is marked **"[UNSTABLE] FOR OPENAI INTERNAL USE ONLY - DO NOT USE."** Avoid it.
- Other account methods: `account/login/cancel`, `account/logout`, `account/read` (optionally refreshes tokens), `account/rateLimits/read` with the `account/rateLimits/updated` notification, `account/usage/read`, and `account/chatgptAuthTokens/refresh` (server-to-client).
- `CODEX_APP_SERVER_LOGIN_CLIENT_ID` env var overrides the client id.

**Inputs.**

- `turn/start` accepts `{type:"text"}`, `{type:"image", url}`, and `{type:"localImage", path}`.
- Per-turn options: `effort` (reasoning effort), `outputSchema`, and model override.
- `thread/start` accepts `baseInstructions` and `developerInstructions`.

**Dynamic tools (experimental).**

- `thread/start.dynamicTools` registers client-side function tools.
- Codex calls back with the server-to-client request `item/tool/call`.
- The client replies with `DynamicToolCallResponse {contentItems:[{type:"inputText"}|{type:"inputImage", imageUrl}|…], success}`.
- **So a tool can return a screenshot image.** jevCUA could therefore run its own click/type/screenshot tools inside a Codex-driven loop. It must opt into the experimental API. [V: protocol source; runtime behaviour U]

**Computer use.** Codex has `ComputerUseConfig` (macOS bundle IDs, Windows AUMIDs/exes). Codex desktop computer use shipped on macOS in April 2026 and on Windows (foreground-only) in May 2026 (https://openai.com/index/codex-for-almost-everything/, https://codex.danielvaughan.com/2026/05/30/codex-computer-use-windows-desktop-automation-qa-testing-workflows/ [S]). There is no Linux computer use, and it isn't something a third-party app can drive as a raw tool. [U for Linux]

### 1c. `@openai/codex-sdk` (TypeScript)

Sources: https://learn.chatgpt.com/docs/codex-sdk, https://github.com/openai/codex/blob/main/sdk/typescript/README.md [V]

- npm `@openai/codex-sdk@0.159.2`, Apache-2.0, Node 18 or newer. It depends on `@openai/codex@0.159.2`, which pulls per-platform native binaries as optionalDependencies (linux/darwin/win32 × x64/arm64). [V: npm registry]
- It spawns `codex exec` and exchanges JSONL over stdio.
- API: `new Codex({env, baseUrl, apiKey, config, configOverrides, codexPathOverride})`, then `startThread({model, sandbox, workingDirectory, skipGitRepoCheck})`, `thread.run()`, `thread.runStreamed()` (async events: items, tool calls, file changes), and `resumeThread(id)`. Threads persist in `~/.codex/sessions`.
- Images: `[{type:"text"}, {type:"local_image", path}]`. Structured output: `outputSchema`.
- Auth: it uses whatever the codex CLI has in `CODEX_HOME` (default `~/.codex/auth.json`, or the OS keyring if `cli_auth_credentials_store=keyring|auto`), or an API key. The SDK has no login API; use `codex login` or app-server for that.
- Latency: each `run()` spawns a process and starts a full agent turn with Codex's system prompt and tools. **[U] No published overhead numbers.** Expect roughly 1 s or more of startup on top of model latency. That fits planning or sub-task calls, not a per-step screenshot/action loop. app-server keeps one process alive and is better for repeated turns.

### 1d. `codex exec`

`codex exec` is the non-interactive CLI (`--json` JSONL events, `--output-schema`, `-i/--image`). It is the same engine as the SDK. Use it for one-shot scripted jobs only.

### 1e. Direct `chatgpt.com/backend-api/codex/responses` with a Codex CLI token

This is what most open-source tools did before SIWC. The Codex source itself defines `CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"`. [V]

- Before 2026-09-29 OpenAI tolerated it but never documented it for third parties. OpenAI didn't block it, unlike Anthropic (see the OpenClaw docs, https://docs.openclaw.ai/providers/openai [S]).
- The new SIWC docs say explicitly: "do not point it at ChatGPT's `backend-api` endpoints". That line is written for SIWC tokens, but it marks backend-api as off-limits for third-party plan usage. [V]
- It reuses Codex's first-party `client_id` `app_EMoamEEZ73f0CkXaXp7hrann` and `originator` headers, which means impersonating the Codex CLI.
- OpenAI Terms of Use ban circumventing rate limits or restrictions and automatically or programmatically extracting output other than through the API. **[U]** openai.com/policies returned 403 to the fetcher, so this is quoted from the known earlier version: https://openai.com/policies/row-terms-of-use/.
- **Verdict:** now the highest-ToS-risk option. It still works today but is likely to be pushed toward SIWC. Don't build on it.

---

## 2. How open-source tools do it

| Tool | Method (source) |
|---|---|
| **opencode** (anomalyco/opencode, `dev`) `packages/opencode/src/plugin/openai/codex.ts` [V] | Still uses the legacy route: `CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"`, issuer `https://auth.openai.com`, `/oauth/authorize` with scope `openid profile email offline_access`, `originator=opencode`, PKCE S256, redirect `http://localhost:1455/auth/callback`. Headless device-code option: POST `{client_id}` to deviceauth, redirect `${ISSUER}/deviceauth/callback`. Requests go to `https://chatgpt.com/backend-api/codex/responses` with `ChatGPT-Account-Id` (from the id_token claim `https://api.openai.com/auth`.chatgpt_account_id) and an `originator` header. Menu labels: "ChatGPT Pro/Plus (browser)", "(headless)", "Manually enter API Key". Listed as a SIWC launch partner, so it will probably migrate. [S] |
| **Pi** (`earendil-works/pi`, formerly badlogic/pi-mono, `@mariozechner/pi-ai`) [V] | Has **both**. (1) `auth/oauth/openai-codex.ts`: legacy Codex client ID, `http://localhost:1455/auth/callback`, scope `openid profile email offline_access`, `originator=pi`, refresh via `/oauth/token` with `grant_type=refresh_token&client_id`, device-code fallback. Its comment: "Port 1455 is shared with the Codex CLI; when it is taken, fall back to the pasted redirect URL". `api/openai-codex-responses.ts` sends to `https://chatgpt.com/backend-api` with headers `Authorization: Bearer`, `chatgpt-account-id`, `originator: pi`, `OpenAI-Beta: responses=experimental`, plus a WebSocket variant. (2) `auth/oauth/openai-chatgpt.ts`: **the new SIWC flow**, `dynamic_agent_client`, `agent_name_hint="Pi"`, `https://auth.openai.com/api/accounts/authorize` and `/api/accounts/oauth/token`, `resource=https://api.openai.com/v1`, scope `… resource.invoke chatgpt.tokens.use.direct`, redirect `http://127.0.0.1:1455/auth/callback`, a 3-minute pre-expiry refresh margin, and a paste-the-redirect-URL fallback if the port is busy. **This file is the best reference implementation for jevCUA** (MIT; check the license before copying). |
| **OpenClaw** [S] | Provider id `openai`, `openclaw onboard --auth-choice openai-codex`. Runs agent turns through the **native Codex app-server harness** by default; the default model is `openai/gpt-6-astra`. Earlier it ran a local proxy that rewrote requests into Codex shape. Listed as a SIWC open-source launch app. https://docs.openclaw.ai/providers/openai |
| **Cline** [S] | "OpenAI Codex" provider with a "Sign in with OpenAI" button, launched 2026-01-22. https://cline.bot/blog/introducing-openai-codex-oauth, https://docs.cline.bot/provider-config/openai. No OpenAI endorsement stated. |
| **Kilo Code** [S] | "OpenAI – ChatGPT Plus/Pro" provider (https://kilo.ai/docs/ai-providers/openai-chatgpt-plus-pro). Now a SIWC commercial launch partner. |
| **Zed** [S] | "ChatGPT Subscription" provider with OAuth 2.0 + PKCE using **the Codex CLI client ID**, a local callback server, and tokens in the system keychain (https://zed.dev/docs/ai/use-an-existing-subscription, PR https://github.com/zed-industries/zed/pull/56811). |
| **Roo Code** | Not checked. [U] |
| **Vercel AI SDK community** [S] | `ai-sdk-provider-codex-cli` (ben-vargas, MIT) has two modes, `codexExec` (spawn per call) and `codexAppServer` (persistent JSON-RPC, delta streaming), and reuses `codex login` credentials. Listed at https://ai-sdk.dev/providers/community-providers/codex-cli; repo https://github.com/ben-vargas/ai-sdk-provider-codex-cli. The same author's `ai-sdk-provider-chatgpt-oauth` (direct backend-api) is the riskier variant. |

**OpenAI statements.** There was no formal endorsement of the legacy client-ID reuse. OpenClaw docs claim OpenAI "explicitly supports" it [S, unverified]. Sam Altman at DevDay 2026: "They're already paying for an AI subscription, and now you don't have to cover their token costs" [S]. SIWC is the official and supported mechanism going forward.

---

## 3. Models, limits, latency

Sources: https://learn.chatgpt.com/docs/models, https://learn.chatgpt.com/docs/pricing [V as fetched; these names are newer than my training data, so treat details as page-as-read]

**Current Codex models:**

- **GPT-6 Astra** (`gpt-6-astra`): most capable. The docs say it combines "advanced reasoning, computer use, and stronger judgment".
- **GPT-6.1 Sol** (`gpt-6.1-sol`): new at DevDay; "near-Astra" at lower cost.
- **GPT-6 Sol**.
- **GPT-6 Luna** (`gpt-6-luna`): efficient, high-volume.
- **Retirements:** GPT-5.5 retires 2026-10-14. GPT-5.3-Codex-Spark retired 2026-09-14. Older GPT-5.x-codex slugs should be considered gone or going.

**Reasoning effort:** Light, Medium, High, Extra High, plus Max (deep single-task) and **Ultra** (parallel subagents). API enum names such as `low/medium/high/xhigh` are **[U]**; read them from the generated app-server schema (`ReasoningEffort`) or `/v1/models`.

**Images:** "Image input support varies by model". Check per slug from `/v1/models` metadata. [U per model]

**Computer use:**

- The Astra model is computer-use capable, and the Codex desktop app has computer use (macOS and Windows).
- **The SIWC route rejects the native `computer_use` tool.**
- With a subscription, jevCUA must either implement its own function-tool CUA over screenshots or drive Codex app-server with dynamic tools.

**Plus / Business limits (local messages per 5 h):**

| Model | Messages per 5 h |
|---|---|
| Astra | 5–45 |
| GPT-6.1 Sol | 15–160 |
| GPT-6 Sol | 15–150 |
| Luna | 350–3,000 |

- ChatGPT credits extend the limits.
- **Pro ($100 / $200 / $500):** "no five-hour limit". Astra Ultrafast is on the $500 tier only.
- **Enterprise/Edu with flexible pricing:** no fixed limit.
- Weekly caps exist; the numbers were not captured. [U]

**Latency fit:**

- A per-step CUA loop means 1 call per action and dozens to hundreds per task. Against Plus limits (Astra 5–45 per 5 h) that runs out almost at once.
- Use the subscription for **planning, replanning, verification, and hard steps** (Astra or Sol).
- Use a cheap or fast model (Luna through the subscription, OpenRouter, or local) for per-step grounding and actions.
- Pro is the only tier where subscription-driven per-step looping is realistic.
- SIWC requires `stream:true` and has no WebSocket, so every step pays a full HTTPS request plus resent context. **[U]** No latency numbers are published.

---

## 4. Electron considerations

- **Loopback server.** Run it in the **main process**: Node `http.createServer` bound to `127.0.0.1` (SIWC forbids `localhost` in the redirect). Open the auth URL with `shell.openExternal` in the system browser, not a BrowserWindow.
  - Port 1455 is the convention and is shared with Codex CLI logins. Try 1455; SIWC allows another port, so fall back to an ephemeral port.
  - Keep pi's "paste the redirect URL" fallback.
  - Validate `state` and `nonce`, time out after about 5 minutes, and close the server after one callback.
  - Never expose tokens to the renderer; renderer to main goes over IPC only.
- **Token storage.**
  - Use Electron **`safeStorage`** (Keychain / DPAPI / libsecret or kwallet) to encrypt a blob and write it with 0600 permissions under `app.getPath('userData')`.
  - On Linux, check `safeStorage.getSelectedStorageBackend()`. If it is `basic_text` (no keyring), warn the user or refuse to persist.
  - `keytar` was archived by Atom in 2022 [U: from memory]; avoid it.
  - Codex itself supports `cli_auth_credentials_store = keyring|auto|file|ephemeral` (https://learn.chatgpt.com/docs/auth [V]).
- **Isolation.** When spawning codex, set **`CODEX_HOME`** to an app-private dir so jevCUA neither clobbers nor silently reuses the user's `~/.codex/auth.json`. Offer reusing `~/.codex` as an explicit opt-in.
- **Bundle vs require install.**
  - `@openai/codex` ships prebuilt native binaries per platform through optionalDependencies, so bundling is practical. Use electron-builder `asarUnpack` for the vendor binary and `codexPathOverride` in the SDK. It costs tens of MB per platform [U size].
  - Pin the version and generate app-server TS types from the pinned binary.
  - Optionally let the user point at a system `codex`.
- **License.** openai/codex is **Apache-2.0** (repo LICENSE and npm `license` field [V]). Redistribution is fine with the LICENSE/NOTICE kept. Don't use OpenAI marks beyond the SIWC button guidelines.

---

## 5. Anthropic (Claude subscription OAuth)

**Not allowed.** https://code.claude.com/docs/en/legal-and-compliance [V] says:

> "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users … developers may not collect, store, or intermediate Claude.ai credentials or session tokens"

Developers, including Agent SDK users, must use API keys. The only allowed subscription use is the **unmodified Claude Code binary** signed in by the end user. History: blocked 2026-01-09, then reverted; ToS changed February 2026; enforced 2026-04-04 [S: https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/]. For jevCUA: Anthropic by API key only.

---

## 6. Recommendation

**Primary path: SIWC plan usage, direct Responses API from the Electron main process.**

- Implement the documented flow in main: dynamic registration, PKCE, `127.0.0.1` loopback, `ext_agent_host_id` as a persisted `urn:uuid`, refresh, revoke, and ID-token validation.
- Call `https://api.openai.com/v1/responses` with `store:false`, `stream:true`, `input_image` screenshots, and our own function tools. This is the same wire format as our OpenAI API-key provider, so one provider adapter covers API key, ChatGPT plan, and OpenAI-compatible local models, differing only in auth and parameter filtering.
- Follow the UI/UX rules and handle `subscription_sharing_usage_limit_exceeded` by falling back to another provider.
- Use it for planner/verifier calls; route per-step actions to a cheaper model.
- **Blocker to resolve first:** eligibility for a *private* app. Either publish jevCUA as open source (the docs say all open-source apps are eligible) or submit the interest form (https://openai.com/form/sign-in-with-chatgpt-interest/). Until then, using `dynamic_agent_client` from a closed app is a grey area but still far safer than backend-api.

**Fallback: official Codex binary via `codex app-server` (bundled `@openai/codex`, private `CODEX_HOME`).**

- Login goes through `account/login/start {type:"chatgpt"}`: open `authUrl` and wait for `account/login/completed`. Also `chatgptDeviceCode`. Codex owns its tokens and refresh.
- The user is using the official Codex client with its own login, which has been sanctioned since 2025.
- Use `turn/start` with `localImage` plus `outputSchema` for planning and verification turns. Optionally use experimental `dynamicTools` so Codex can call jevCUA's screenshot/click tools, which can return `inputImage`.
- Heavier and with more latency. Use it for planning, not per step.
- `@openai/codex-sdk` is a simpler wrapper for one-shot plan and verify calls, but it has no login API.

**Avoid:**

- Reusing the Codex CLI client ID (`app_EMoamEEZ73f0CkXaXp7hrann`) against `chatgpt.com/backend-api/codex/responses`, as opencode (legacy), Zed, and older Pi do. It impersonates first-party Codex and is now contradicted by OpenAI's SIWC docs.
- `chatgptAuthTokens` ("OpenAI internal use only").

## Unverified / to check

- Whether "locally hosted" private apps qualify for SIWC without open-sourcing.
- Exact SIWC revoke URL and token lifetime (see /siwc token reference).
- Per-model image support and API effort enum names.
- Weekly caps.
- Codex spawn and turn latency.
- Current OpenAI ToU wording (page returned 403).
- Roo Code's approach.
- Whether opencode's built-in plugin has moved to SIWC after DevDay (the `dev` branch still showed the legacy flow on 2026-09-30).
