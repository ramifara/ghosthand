# Model layer: libraries, OAuth, catalog, registry design

Researched 2026-09-30. Sources: shallow clones under `research/refs/` (`vercel-ai` at ai@7.0.124, `pi-mono` at pi-ai 0.99.2, `models.dev`, sparse `opencode`), the npm registry (`registry.npmjs.org/<pkg>/latest`, no key), and official docs. Labels:

- **[src]** read in cloned source on 2026-09-30.
- **[doc]** read in an official doc page on 2026-09-30.
- **[npm]** from the npm registry metadata.
- **[community]** third-party article or repo README.
- **[unverified]** not confirmed.

This builds on `openrouter-jev.md` and `plan/AGENT_PLAN.md` (Jev via OpenRouter, `DecisionModel` interface, OpenRouter for all chat roles by default).

---

## 1. Hosted native computer-use tools (Sept 2026)

| Vendor | Tool / API | Models | Coordinates | Status |
|---|---|---|---|---|
| Anthropic | `computer_toolset_20260801` (client toolset, 17 member tools incl. `zoom`, `left_click_drag`, `hold_key`, `wait`), Messages API. No beta header. | Opus 5.5, Sonnet 5.5, Opus/Sonnet 5, Mythos 5/5.1, Fable 5/5.1, Opus 4.8. Claude 5.5+ on Claude API **only** accept the toolset and reject `computer_20251124`. Older `computer_20251124` (beta header) for Opus 4.5–4.7, Sonnet 4.6. | Screenshot pixel space. Downscale to <=1568 px long edge and ~1.15 MP, scale back. Batch actions run sequentially, stop at first failure. | GA on Claude API and Google Cloud; beta on Bedrock/Foundry/AWS [doc] https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool |
| OpenAI | `computer` tool, **Responses API only**. `computer_use_preview` deprecated. Actions batched in one `computer_call.actions[]`: click, double_click, drag, move, scroll, keypress, type, wait, screenshot. Screenshots sent with `detail: "original"`. | Docs examples use `gpt-6-astra` and `gpt-6.1-sol`; GPT-5.4/5.5 also support it. | Screenshot pixels. | GA [doc] https://developers.openai.com/api/docs/guides/tools-computer-use . Agents API also got hosted-browser computer use on 2026-09-29 [community: search snippet of https://openai.com/index/devday-2026-recap/]. |
| Google | `computer_use` tool via the **Interactions API** (`client.interactions.create`, `previous_interaction_id`). Environments BROWSER, MOBILE, DESKTOP on 3.x. Gemini 3.x actions carry an `intent`; names `click`, `type`, `scroll`, `drag_and_drop`, `navigate`, `press_key`, `hotkey`, `take_screenshot`. Opt-in prompt-injection detection. | Docs list `gemini-3.8-flash`, `gemini-3.5-flash` (GA); legacy `gemini-2.5-computer-use-preview-10-2025` (browser only). Secondary sources disagree on which 3.x models have it, so check the doc at build time. | **Normalized 0–999** grid, scale to screen. | [doc] https://ai.google.dev/gemini-api/docs/computer-use |

Consequences for us:

- The three schemas differ (pixel vs 0–999; batched vs single; intent field). Our executor must own one internal `Action` type and have per-vendor adapters. Keep our own "grounding via JSON" path (`{x,y}` in screenshot pixels or normalized 0–1000) for OpenRouter and local VLMs, which have no native tool.
- Whether OpenRouter passes vendor-native computer tools through is **[unverified]**. Treat native CU as available only on direct Anthropic / OpenAI / Google keys (and on ChatGPT-OAuth if eligible, **[unverified]**).
- Vercel AI SDK v7 ships all three natively [src]: `packages/anthropic/src/tool/computer-toolset_20260801.ts` (+ `computer_20251124`, older), `packages/openai/src/tool/computer.ts`, and `google.computer_use` in `packages/google/src/interactions/prepare-google-interactions-tools.ts`. pi-ai has none (no `computer`/`toolset` in `src/`) [src].

---

## 2. ChatGPT / Codex subscription via OAuth

Three mechanisms exist:

1. **Official "Sign in with ChatGPT" (SIWC) plan usage** [doc] https://developers.openai.com/siwc/token-sharing-open-source , cookbook https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
   - OIDC + PKCE + dynamic client registration, no client secret. Scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. The bearer token goes to the **public Responses API on api.openai.com**; usage bills to the user's Plus/Pro plan. Users set per-app weekly caps at chatgpt.com/settings/usage.
   - Eligibility: "open-source projects, personal projects that run locally, and selected private apps". Paid or remotely hosted apps must use the interest form/waitlist. A private, locally run Electron app used by Rami fits "personal projects that run locally".
   - "Eligible Responses API requests": which models and tools (computer, structured output, images) are eligible is not stated. **[unverified]**; test live.
   - Reference implementation (MIT): pi-ai `packages/ai/src/auth/oauth/openai-chatgpt.ts` [src]: `AUTHORIZE_URL https://auth.openai.com/api/accounts/authorize`, `TOKEN_URL .../oauth/token`, `client_id=dynamic_agent_client` (OpenAI returns the issued client_id in the callback), loopback `http://127.0.0.1:1455/auth/callback`, manual paste-the-callback-URL fallback, refresh 3 min before expiry.
2. **Codex backend (legacy)**: Codex CLI's public OAuth client, requests go to `https://chatgpt.com/backend-api` (Codex Responses). pi-ai keeps it as "OpenAI Codex (legacy)", superseded by SIWC [src]. LiteLLM `chatgpt/*` uses a device-code flow against this path and strips `max_output_tokens`/`metadata` [doc] https://docs.litellm.ai/docs/providers/chatgpt . Undocumented backend, can break. Use only as a fallback.
3. **Spawn Codex CLI**: `ai-sdk-provider-codex-cli` 2.3.0 (MIT, 2026-09-23, AI SDK v7, `codexExec` or `codexAppServer` JSON-RPC with real streaming; images via temp files; JSON schema output) https://github.com/ben-vargas/ai-sdk-provider-codex-cli . Needs a Codex CLI binary and runs Codex's own agent loop, which is heavy for per-step planner calls. `ai-sdk-provider-chatgpt-oauth` 1.1.0 is stale (2025-09-16, AI SDK v5) [npm]. `vishhvak/chatgpt-oauth` (MIT, "experimental, unofficial", AI SDK provider, Electron "expected to work") https://github.com/vishhvak/chatgpt-oauth .

**Choice:** implement SIWC ourselves in the Electron main process (port ~300 lines from pi-ai's MIT code). Store tokens with Electron `safeStorage`. Feed the access token into `@ai-sdk/openai` through a custom `fetch` that injects `Authorization` and refreshes under a lock. Keep the Codex-backend path behind a flag as a fallback.

---

## 3. Library comparison

Versions from npm on 2026-09-30. Electron 44.5.1 (2026-09-29) bundles Node 24.21, so every `node>=22` package runs in the main process. Everything below is ESM, which Electron main supports.

### 3.1 Vercel AI SDK v7 (`ai` 7.0.124, Apache-2.0)
- Packages [npm]: `@ai-sdk/openai` 4.0.83, `@ai-sdk/anthropic` 4.0.70, `@ai-sdk/google` 4.0.87, `@ai-sdk/openai-compatible` 3.0.61, `@openrouter/ai-sdk-provider` 3.1.0 (2026-09-19, peers `ai@^7`, ESM-only, Node 22+), `@ai-sdk/typesafe-ai` 3.0.12. Local: `ollama-ai-provider-v2` 4.0.1 (Apache-2.0, 356 kB) or `ai-sdk-ollama` 4.4.0 (10 MB); LM Studio / llama.cpp / vLLM via `@ai-sdk/openai-compatible` (`supportsStructuredOutputs: true` enables `response_format: json_schema`).
- Unpacked sizes: `ai` 7.8 MB, openai 3.1 MB, anthropic 2.3 MB, google 2.3 MB, openai-compatible 0.4 MB, openrouter 1.7 MB. Only 3 runtime deps for `ai` (gateway, provider, provider-utils) plus peer `zod`. No vendor SDKs; it is fetch-based.
- Features [src]: `generateText`/`streamText` with tools, image parts, `Output.object` structured output (zod/JSON schema), `abortSignal`, `timeout` (`TimeoutConfiguration` in `generate-text.ts:1651`), `maxRetries`, provider registry (`createProviderRegistry`, `customProvider` which also takes `evaluationModels`), OTel telemetry, `usage` tokens incl. reasoning/cache. **No built-in dollar cost**: `@openrouter/ai-sdk-provider` exposes OpenRouter's `usage.cost` in provider metadata; for others compute from a price table.
- Native CU tools for all three vendors (section 1). Best of any option.
- **Decisions:** `experimental_evaluate({model, state, questions})` in `packages/ai/src/evaluate/evaluate.ts` [src]. Question types `choice`/`score`/`boolean`. Evaluation models come from `@ai-sdk/typesafe-ai` (`typeSafeAi.evaluationModel('jev-latest')`, TypeSafe confidence in `providerMetadata.typesafe.confidence`), `@ai-sdk/gateway` (Vercel AI Gateway), `@ai-sdk/anthropic` (`evaluationModel()` emulated over Messages), and `@openrouter/ai-sdk-provider` 3.1.0 `openrouter.evaluationModel()` via the OpenRouter Decisions API (needs `ai>=7.0.103`) [community: provider changelog https://github.com/OpenRouterTeam/ai-sdk-provider/blob/main/CHANGELOG.md]. Validates rounding and answer shape. Marked experimental: API may change in minors.
- Also ships `harness-*` packages (codex, claude-code, pi, opencode…) that run whole agent CLIs in sandboxes. Not relevant for per-call roles.
- OAuth: none built in; bring your own token via `apiKey`/`fetch`.
- Maintenance: very active (commit today), large team.

### 3.2 pi-ai (`@earendil-works/pi-ai` 0.99.2, MIT; formerly `@mariozechner/pi-ai`, which is now deprecated at 0.73.1)
Repo https://github.com/earendil-works/pi (cloned as `refs/pi-mono`), `packages/ai`. Read in source:
- **Architecture:** a `Models` collection holds `Provider`s. Each provider owns its catalog, auth and stream. Providers share wire "APIs" (`anthropic-messages`, `openai-responses`, `openai-completions`, `openai-codex-responses`, `google-generative-ai`, `google-vertex`, `bedrock-converse-stream`, `mistral-conversations`, …). Most gateways use `openai-completions` with a `compat` block auto-detected from `baseUrl`. SDKs (`openai` 7.19, `@anthropic-ai/sdk` 0.124, `@google/genai` 2.21, AWS) load lazily per API. Per-provider subpath imports (`/providers/openai`) keep bundles small; `/providers/all` pulls everything.
- **Registry:** generated catalogs (`scripts/generate-models.ts`, partly fed from models.dev and OpenRouter) typed with literal IDs. `Model` has `api, provider, baseUrl, input: ('text'|'image')[], reasoning, thinkingLevelMap, contextWindow, maxTokens, cost{input,output,cacheRead,cacheWrite} per M, compat, headers`. Chat catalog only lists tool-calling models. Dynamic providers (`models.refresh({providers:['llamacpp']})`) for local/live lists. Model `type`: `chat | image | classifier`.
- **OAuth:** Anthropic (Claude Pro/Max), OpenAI SIWC (`openai-chatgpt.ts`), OpenAI Codex (legacy), GitHub Copilot (device code), OpenRouter PKCE (mints a permanent key), xAI, Kimi, Radius. `CredentialStore` contract (`read/list/modify/delete`); refresh runs inside `modify`, so no double refresh across processes. A stored credential beats env vars and never silently falls back. OAuth login is Node-only and lazy-loaded.
- **Cost:** every `AssistantMessage.usage` has tokens plus `cost{input,output,cacheRead,cacheWrite,total}` computed from catalog prices (`calculateCost`). Partial usage is kept on abort/error.
- **Abort/timeouts:** `signal`, `timeoutMs`, WebSocket connect timeout. Errors never throw after the stream starts; `stopReason` is `error` or `aborted` with partial content. Retries honor `Retry-After`.
- **Tools/JSON:** TypeBox schemas, partial-JSON streaming of tool args, validation, `constrainedSampling: {type:'json_schema', strict:'prefer'|'require'}` on OpenAI, Anthropic, Bedrock, Mistral, Gemini 3. **No `response_format`-style structured output for plain text**; you get JSON by forcing a strict tool. OpenAI Lark/regex grammar tools.
- **Vision:** image input on `input.includes('image')` models. Images sent to non-vision models are silently dropped (we must guard).
- **Classifier (Jev):** `models.classify(model, {state, questions})` with `choice/score/bool`. Built-in on `typesafe` (`jev-latest`), `openrouter` (`typesafe/jev-1.13`, `~typesafe/jev-latest`, via OpenRouter's System One endpoint), `cloudflare-workers-ai`, `vercel-ai-gateway`, `opencode`. `llama-cpp-classify` turns any llama-server chat model into a logprob classifier (single-token labels, softmax, prompt-cache reuse). That is a good local Jev substitute.
- **Gaps:** no native computer-use tools. Pre-1.0 with frequent breaking changes (0.99.0 on 2026-09-29 was breaking; package renamed). Node >=22.19. 4 MB plus vendor SDKs (openai 20 MB, anthropic 11 MB, genai 12 MB unpacked, lazy-loaded).

### 3.3 OpenAI Agents SDK JS (`@openai/agents` 0.18.0, MIT)
An agent loop (handoffs, guardrails, tracing, sessions) centered on OpenAI Responses. It has a computer tool. Other providers go through `@openai/agents-extensions/ai-sdk` (peers `ai@^6||^7`; still beta; computer tools need environment+dimensions metadata) https://openai.github.io/openai-agents-js/extensions/ai-sdk/ . We are building our own loop, so this adds an opinionated runtime without solving provider selection. Not recommended as the model layer.

### 3.4 LangChain.js (`langchain` 1.5.14, `@langchain/core` 1.2.13 7.6 MB, `@langchain/openai` 1.6.0; MIT)
Broad providers, `withStructuredOutput`, `bindTools`, streaming, abort. Heavier abstractions (Runnables, message classes), no native CU tool wrappers of the same quality, no subscription OAuth, cost via callbacks/LangSmith. Only worth it if we adopt LangGraph. We are not.

### 3.5 Mastra (`@mastra/core` 1.72.0, Apache-2.0, **71 MB unpacked, 30 deps**)
Agent framework whose model router uses models.dev plus OpenRouter lists ("provider/model" strings, thousands of models) and accepts AI SDK v7 `LanguageModelV4` directly [community] https://mastra.ai/models . Useful as proof that models.dev + AI SDK is a workable catalog/runtime pairing. Too heavy to embed for just the model layer.

### 3.6 token.js (0.7.1, MIT)
OpenAI-format unified client. Last updated 2025-04 [community] https://github.com/token-js/token.js . Stale. Skip.

### 3.7 LiteLLM proxy as sidecar (`litellm` 1.103.1, Python)
Covers the most providers, has cost tracking, budgets, fallbacks, a `chatgpt/*` subscription provider (device code, Codex backend), and OpenAI-compatible output. Costs: a Python process to ship and supervise inside an Electron app on Linux/Win/Mac, an extra hop, and loss of vendor-native CU tool shapes behind an OpenAI-format facade. Useful as an optional dev/debug gateway, not as the core.

### 3.8 Summary matrix

| | AI SDK v7 | pi-ai 0.99 | OpenAI Agents JS | LangChain.js | Mastra | LiteLLM sidecar |
|---|---|---|---|---|---|---|
| OpenAI/Anthropic/Gemini/OpenRouter keys | yes (official pkgs) | yes | OpenAI native, rest via AI SDK | yes | yes (via AI SDK) | yes |
| Local (Ollama/LM Studio/llama.cpp/vLLM) | openai-compatible, ollama providers | openai-completions + dynamic refresh; llama.cpp classify | via AI SDK | yes | yes | yes |
| Vision input | yes | yes (silently drops on non-vision) | yes | yes | yes | yes |
| Structured output | `Output.object`, native json_schema | strict tool only | yes | yes | yes | passthrough |
| Native computer-use tools | Anthropic toolset_20260801, OpenAI `computer`, Gemini `computer_use` | none | OpenAI only | partial | via AI SDK | flattened |
| Streaming / abort / timeout | yes / yes / yes | yes / yes / `timeoutMs` | yes | yes | yes | yes |
| $ cost accounting | no (OpenRouter metadata only) | yes, per message | tracing only | callbacks | yes | yes |
| Subscription OAuth | none (BYO) | SIWC, Codex, Claude Pro/Max, Copilot, OpenRouter PKCE | no | no | no | ChatGPT (device code) |
| Decision/classifier | `experimental_evaluate` + typesafe-ai / openrouter / gateway | `models.classify` + llama.cpp local | no | no | no | no |
| Size | small core, fetch-based | 4 MB + lazy vendor SDKs | small + extensions | large | 71 MB | Python runtime |
| Stability | semver, mature | pre-1.0, frequent breaks | 0.x | 1.x | 1.x | mature |

---

## 4. models.dev as our catalog

- MIT, very active (commit 2026-09-30), 226 providers, TOML per provider/model. `https://models.dev/api.json` (by provider), `/models.json` (provider-agnostic), `/catalog.json` (both), `?type=decision` or `?type=all` for decision models, logos at `/logos/{provider}.svg`. Typed client `@opencode-ai/models` 0.0.90 [src] `refs/models.dev/README.md`, `packages/sdk`.
- Fields per model [src `packages/core/src/schema.ts`]: `attachment, reasoning, reasoning_options, tool_call, structured_output, temperature, interleaved, knowledge, release_date, last_updated, modalities{input,output}, open_weights, limit{context,input,output}, cost{input,output,reasoning,cache_read,cache_write,input_audio,output_audio, tiers}, status(alpha|beta|deprecated), provider{npm, api, shape: responses|completions}`. Provider: `env[], npm, api, doc`. The `npm` field names the AI SDK package to load, so it pairs directly with AI SDK.
- `type = "decision"` exists (only value of `MODEL_TYPES`). `models/typesafe/jev-latest.toml` lists 64k context; Jev also appears under opencode, vercel, cloudflare-ai-gateway, nano-gpt, vivgrid.
- **Missing for us:** no `computer_use` flag, no grounding-coordinate convention, no latency/throughput, no local-server live model list (`lmstudio` and `ollama-cloud` entries are static). OpenRouter pricing there can lag OpenRouter's own `/api/v1/models`.
- **How opencode uses it** [src `refs/opencode/packages/core/src/models-dev.ts`, `packages/opencode/src/provider/provider.ts`]: fetches `${OPENCODE_MODELS_URL || "https://models.opencode.ai"}/api.json`, caches to disk with a cross-process file lock, falls back to a build-time embedded snapshot (`OPENCODE_MODELS_DEV`), and exposes `refresh()`. `fromModelsDevModel()` maps to `capabilities{temperature, reasoning, attachment, toolcall, input{text,image,audio,video,pdf}, output{…}, interleaved}` plus `cost` and `limit`. User config overrides and adds models field by field (`model.x ?? existing.x ?? default`). Provider SDKs resolve from `model.provider.npm ?? provider.npm`; bundled SDKs are used first, otherwise opencode installs the npm package at runtime. We won't do runtime npm installs in Electron. We will bundle a fixed set of AI SDK providers.

**Verdict:** yes, use models.dev as the **base** catalog. Ship a snapshot inside the app, refresh it in the background (daily, with ETag), and layer our own override file on top for `computer_use`, grounding convention, latency tier, and eval scores. For OpenRouter, merge its live `/api/v1/models` (pricing, `supported_parameters` such as `structured_outputs`/`tools`, `?output_modalities=decisions`). For local servers, query `GET /v1/models` (Ollama `/api/tags` + `/api/show` for vision capability) live.

---

## 5. Recommendation

**Runtime: Vercel AI SDK v7** (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@openrouter/ai-sdk-provider`, `@ai-sdk/openai-compatible`, optionally `ollama-ai-provider-v2`), in the Electron **main process** (or a utility process). Never in the renderer, which would expose keys.

Why AI SDK over pi-ai:
1. Native computer-use tools for all three vendors, today, including Anthropic's `computer_toolset_20260801`, which Claude 5.5+ requires. pi-ai has none, and adding server-defined tools to it means forking API adapters.
2. First-class structured output (`Output.object` with zod), not only strict-tool emulation.
3. Semver stability, a large maintainer team, and small fetch-based providers (no vendor SDKs).
4. `experimental_evaluate` plus `openrouter.evaluationModel()` gives the decision path an off-the-shelf option on the same key.

What we add ourselves (small):
- **Auth module**: SIWC OAuth (port from pi-ai `openai-chatgpt.ts`, MIT, keep attribution), optional OpenRouter PKCE (pi-ai `oauth/openrouter.ts`), and a credential store on Electron `safeStorage` with locked refresh (copy pi-ai's `CredentialStore.modify` semantics).
- **Cost meter**: `usage × catalog price`, preferring OpenRouter's returned `usage.cost` when present. Local = 0.
- **Registry + role router** (section 6).

**Fallback option:** if subscription OAuth breadth (Claude Pro/Max, Copilot) matters more than native CU tools, use pi-ai as the runtime for text/vision/JSON roles, and call AI SDK only for native-CU grounding. A second hybrid: use pi-ai only as the auth/credential manager (`models.getAuth('openai')` returns refreshed headers) and pass those headers to AI SDK. Both work because both libraries are fetch/header driven. They cost two model abstractions, so we would pick one only if porting OAuth turns out to be painful.

Not recommended as core: OpenAI Agents SDK (OpenAI-centric loop), LangChain.js (weight, abstractions), Mastra (71 MB framework), token.js (stale), LiteLLM (Python sidecar; optional dev gateway only).

---

## 6. Registry design

### 6.1 Types

```ts
type ProviderKind =
  | 'openai' | 'anthropic' | 'google' | 'openrouter'
  | 'openai-chatgpt'            // SIWC OAuth -> api.openai.com Responses
  | 'openai-compatible'         // ollama | lmstudio | llamacpp | vllm | custom
  | 'typesafe' | 'openrouter-decisions';

type AuthRef =
  | { type: 'api_key'; credentialId: string }          // safeStorage
  | { type: 'oauth'; credentialId: string }            // SIWC tokens + refresh
  | { type: 'none' };                                  // local

interface ProviderConfig {
  id: string;                    // 'openrouter', 'local-lmstudio', ...
  kind: ProviderKind;
  baseUrl?: string;              // required for openai-compatible
  auth: AuthRef;
  headers?: Record<string,string>;
  discovery: 'models.dev' | 'openrouter-live' | 'openai-models-endpoint' | 'ollama-tags' | 'static';
}

type GroundingConvention = 'pixels' | 'norm1000' | 'norm999' | 'none';
type NativeComputerTool = 'anthropic_toolset_20260801' | 'anthropic_20251124' | 'openai_computer' | 'gemini_computer_use';

interface ModelCaps {
  vision: boolean;               // models.dev modalities.input has 'image'
  tools: boolean;                // tool_call
  json: 'native' | 'strict-tool' | 'prompt' | 'none';   // structured_output / supported_parameters
  reasoning: boolean;
  computerUse?: NativeComputerTool;       // our override file
  grounding: GroundingConvention;         // our override / eval
  contextTokens: number; maxOutputTokens: number;
  cost?: { inPerM: number; outPerM: number; cacheReadPerM?: number; cacheWritePerM?: number };
  latencyTier: 'realtime' | 'fast' | 'standard' | 'slow';   // measured p50 buckets
  local: boolean; zdr?: boolean; status?: 'alpha'|'beta'|'deprecated';
}

interface ModelEntry { provider: string; id: string; name: string; type: 'chat' | 'decision'; caps: ModelCaps; source: ('models.dev'|'openrouter'|'local'|'override')[] }

type Role = 'planner' | 'writer' | 'vision_reviewer' | 'grounding' | 'judge' | 'decision';

interface RoleRequirement { vision?: true; json?: true; tools?: true; computerUse?: 'native'|'any'; minContext?: number; maxLatencyTier?: ModelCaps['latencyTier'] }

const ROLE_REQUIREMENTS: Record<Role, RoleRequirement> = {
  planner:         { json: true, tools: true, minContext: 64_000 },
  writer:          { maxLatencyTier: 'fast' },
  vision_reviewer: { vision: true, json: true },
  grounding:       { vision: true, computerUse: 'any' },     // native tool OR grounding != 'none'
  judge:           { vision: true, json: true },
  decision:        {},                                        // DecisionProvider only
};

interface RoleBinding {
  role: Role;
  primary: { provider: string; model: string; params?: { temperature?: number; reasoning?: 'low'|'medium'|'high'; maxOutputTokens?: number } };
  fallbacks?: RoleBinding['primary'][];
  timeoutMs: number; maxRetries: number; budgetUsdPerRun?: number;
}
```

### 6.2 Behavior
- **Catalog build:** models.dev snapshot, then OpenRouter live, then local discovery, then `overrides.json` (computer_use, grounding, latencyTier, local vision flags). Later layers win field by field, as in opencode's `?? existing ??` merge.
- **Selector UI:** per role, list models whose caps satisfy `ROLE_REQUIREMENTS`. Show badges (vision, JSON native/emulated, CU native, context, $/M in/out, latency tier, local, ZDR), and grey out non-matching models with the reason. Show auth state per provider (key set, OAuth signed in, local server reachable).
- **Call path:** `llm.run(role, request)` resolves the binding, builds an AI SDK `LanguageModel` (cached per provider+model), applies `abortSignal` (a run-level controller plus a per-call timeout), and records `{role, provider, model, tokens, costUsd, latencyMs, stopReason}` to the run log and budget meter. On a retryable error or timeout, move to the next fallback.
- **JSON:** `json: 'native'` means `Output.object`; `'strict-tool'` means a forced single tool; `'prompt'` means a prompt plus zod repair with one retry.
- **Grounding:** if `computerUse` is native and the provider is direct, use the vendor tool and translate to our `Action`. Otherwise use a JSON grounding prompt and convert with `grounding` (pixels / norm1000 / norm999) and the screenshot scale factor.
- **Latency tier:** filled by our own benchmark harness (p50 per model on a fixed screenshot+JSON prompt), stored in overrides. Neither models.dev nor OpenRouter provide it (OpenRouter `latency_last_30m` is often null).

### 6.3 Decision provider class (Jev)
Keep decisions **outside** the chat `LanguageModel` abstraction, as `plan/AGENT_PLAN.md` already specifies:

```ts
interface DecisionProvider {
  id: string;
  capabilities(model: string): { questionTypes: ('choice'|'score'|'bool')[]; maxOptions: number; maxLevels: number; contextTokens: number; calibration: 'native'|'logprob'; zdr: boolean };
  ask(model: string, state: JsonValue, questions: Record<string, Question>, opts: { signal: AbortSignal; timeoutMs: number }): Promise<{ answers; usage: { tokens: number; costUsd: number }; latencyMs: number; raw }>;
}
```

Implementations:
- `OpenRouterDecisions`: default. Plain `fetch` to `POST https://openrouter.ai/api/alpha/decisions` (see `openrouter-jev.md`) with `provider:{zdr:true}`. Alternatively wrap AI SDK `experimental_evaluate({ model: openrouter.evaluationModel('~typesafe/jev-latest') })`. Keep our own validator either way (the evaluate API is experimental).
- `TypeSafeDirect` (same schema, `api.typesafe.ai/v1/systemone`).
- `LlmLogprobDecisions`: emulation over any chat model with logprobs, including local llama.cpp, following pi-ai's `llama-cpp-classify` design (single-token labels, softmax, shared prompt prefix for cache hits, temperature >1 to soften).
- The registry lists decision models (`type:'decision'`, from models.dev `?type=decision` and OpenRouter `?output_modalities=decisions`) in their own selector section, bound only to the `decision` role.

---

## 7. Open items / to verify live
- Which models, and whether the `computer` tool and `text.format` json_schema, are eligible under SIWC plan usage.
- Whether OpenRouter forwards Anthropic/OpenAI native computer tools (if yes, CU works on the single OpenRouter key).
- Exact Gemini 3.x model IDs with `computer_use` at build time (secondary sources conflict).
- `openrouter.evaluationModel()` handling of `score` and `bool` (community only confirmed `choice` via the alpha endpoint).
- Local VLM grounding conventions per model family (Qwen-VL / UI-TARS style norm1000 vs pixels) **[unverified]**, to be measured with our harness.

## Key URLs
- AI SDK: https://ai-sdk.dev/docs , repo https://github.com/vercel/ai , OpenRouter provider https://github.com/OpenRouterTeam/ai-sdk-provider , TypeSafe provider https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai
- pi-ai: https://github.com/earendil-works/pi/tree/main/packages/ai , npm https://www.npmjs.com/package/@earendil-works/pi-ai
- SIWC: https://developers.openai.com/siwc/token-sharing-open-source , https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
- Computer use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool , https://developers.openai.com/api/docs/guides/tools-computer-use , https://ai.google.dev/gemini-api/docs/computer-use
- models.dev: https://models.dev , https://github.com/sst/models.dev ; opencode https://github.com/sst/opencode
- Codex CLI provider: https://github.com/ben-vargas/ai-sdk-provider-codex-cli ; LiteLLM ChatGPT: https://docs.litellm.ai/docs/providers/chatgpt
- OpenAI Agents JS AI SDK adapter: https://openai.github.io/openai-agents-js/extensions/ai-sdk/ ; Mastra models: https://mastra.ai/models ; token.js: https://github.com/token-js/token.js
