# Jev via the direct TypeSafe API and `@typesafe-ai/sdk`: research notes

> Superseded in part by `jev-1-14-images-box.md` (2026-10-17): SDK 0.7.0, image input, `box` questions and the long-context header. The "text only" statements below no longer hold; the text-request facts do.

Researched 2026-09-30. Companion to `openrouter-jev.md`. Sources:

- every page listed in https://docs.typesafe.ai/llms.txt (111 pages, downloaded as `.md`)
- the live OpenAPI spec at https://api.typesafe.ai/openapi.json (spec version 0.2.0)
- the cloned SDKs:
  - `research/refs/typesafe-sdk-js` at v0.6.0, commit 66880cc
  - `research/refs/typesafe-sdk-python` at v0.7.2
- the npm and PyPI registries
- typesafe.ai legal pages and status page
- Vercel, Cloudflare, and Pydantic gateway docs
- community articles

No authenticated calls were made. I only sent unauthenticated probes.

Labels:

- **[docs]**: official TypeSafe docs
- **[spec]**: live OpenAPI
- **[src]**: SDK source code
- **[probed]**: unauthenticated request I sent
- **[community]**: third-party articles
- **[unverified]**: not confirmed

---

## 0. TL;DR

- Direct = `POST https://api.typesafe.ai/v1/systemone` + `GET /v1/models`. **There are no other endpoints.** The OpenAPI spec lists only these two paths, and `/v1/batches` and `/v1/usage` return 404. There is no batch, async, streaming, embeddings, or caching API. The unit of batching is "many questions in one request". [spec, probed]
- What direct gives you over OpenRouter:
  - 64k context (OpenRouter lists 32k)
  - exact version pinning with `jev-1.13.0`
  - the `jev-preview` alias
  - `/v1/models` works
  - `x-typesafe-request-id` on every response
  - the official SDK's typed answers and retry policy with no base-URL hacks
  - no extra network hop (community measurements: median ~180 ms direct vs ~350–530 ms via OpenRouter)
  - enterprise ZDR and higher limits via sales
  - the Playground / console
- What direct lacks compared with OpenRouter or Vercel:
  - no `usage.cost` field (compute it yourself: `input_tokens × $0.042/M`)
  - no response `id` in the body (use the request-id header)
  - no provider or model fallback
  - no session/trace fields
  - ZDR is not self-serve
- Access: signups at https://console.typesafe.ai reportedly **reopened 2026-09-27, with no free credits for new accounts**. The console returned a Cloudflare block page to my curl, so I could not check it directly. [community, unverified]
- TS SDK: `@typesafe-ai/sdk@0.6.0` is the latest on npm (published 2026-09-15). It is small and has zero dependencies. It supports fetch injection, a per-attempt timeout, retries (2 by default, on 408/429/5xx plus connection errors and timeouts), `AbortSignal`, and `.withResponse()` for the request ID.

---

## 1. Capabilities: direct vs OpenRouter

| Capability | TypeSafe direct | OpenRouter | Source |
|---|---|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone` | `/api/alpha/decisions` or `/api/v1/systemone` | docs /api |
| Context | **64k tokens per request (state + all questions); 32k for state + the single longest question** | listed as 32,000; whether OR enforces 32k total or passes the request to TypeSafe's rule is [unverified] | docs /models |
| Model IDs | `jev-1.13.0` (versioned), `jev-latest`, `jev-preview` | `typesafe/jev-1.13`, `~typesafe/jev-latest` | docs /models |
| Pinning | exact semver `jev-1.13.0`; response `model` reports the versioned ID (e.g. `"jev-1.13.0"`) | `typesafe/jev-1.13` → reports a dated snapshot `typesafe/jev-1.13-20260917` | docs /api examples |
| Preview channel | `jev-preview`, currently identical to `jev-latest` ("no preview build available right now") | not exposed | docs /models |
| Model listing | `GET /v1/models` → `{models:[{name,description,release_date}]}`. Currently lists **aliases only**; versioned IDs are accepted even when not listed | TypeSafe SDK `models.list()` is rejected; use the OR Models API | docs /models, spec |
| Question types | noul, choice, score; structured (object/array) `instructions` and `criteria`; backtick path refs like `` `ticket.messages[0].text` `` | same schema passed through | docs /api, /primitives/advanced |
| Limits | choice ≤255 options; score "should" have ≥2 levels, "API accepts up to 10"; `questions` minProperties 1 | same upstream limits | docs /api, spec |
| Batch/async/stream | **none** | none (alpha decisions endpoint only) | spec, probed |
| Request ID | `x-typesafe-request-id: req_<32 hex>` on every response, including errors and 404s | OR `id: gen-dec-…` in body | probed |
| Usage fields | `usage.input_tokens` (billable), `usage.output_tokens` ("currently free of charge"). **No cost field** | adds `usage.cost` | spec |
| Rate limits | 100K tok/s and 40 req/s, "adjusting dynamically … can change without notice"; higher limits on custom/enterprise plans (sales@typesafe.ai). 429 on either limit; 529 when overloaded | OR publishes nothing per model; pooling [unverified] | docs /models |
| Price | $0.042/M input ($42/Btok), output free | same, plus `usage.cost` | docs /models |
| Caching | none documented; no cache pricing | none | docs |
| Fallbacks | none; implement in code | none (no `models` array) | — |
| ZDR | "for enterprise customers. Contact sales@typesafe.ai" | `provider.zdr:true`; Jev is on OR's ZDR list | docs /legal |
| Training on data | "We will not train or fine tune any … models on your prompts or other Input" | OR `training:false` | privacy policy |
| Default retention (non-ZDR) | not specified; "as long as reasonably necessary". Services hosted in the US. Subprocessors listed at https://trust.typesafe.ai/subprocessors | OR `retainsPrompts:false` | privacy policy, DPA |
| Input modalities | text only. "Images, audio, and video are not supported (yet)" | same | docs /concepts/state, /models |
| Languages | English best; CJK and others accepted at lower accuracy | same | docs /models |
| Customization | no fine-tuning or LoRA; same weights for every account; customize through state, instructions, and criteria | same | docs /models |
| Determinism | homepage FAQ asks "Is Jev deterministic?" but the answer loads client-side and I could not read it. The jaggedness page calls Jev "extremely consistent" | — | [unverified] |
| Uptime | status.typesafe.ai: 99.828% over the last ~90 days, with short daily blips (2–59 min) | OR showed 100% at query time | status page |

### Context rule, concretely [docs]

- `tokens(state) + Σ tokens(question_i) ≤ 64k`
- `tokens(state) + max_i tokens(question_i) ≤ 32k`

So with direct you can send a ~30k-token screen/AX-tree state and still fan out many small questions up to 64k total. Via OpenRouter, the 32k listing may cap the *total*, so fan-out would have to shrink.

- No tokenizer is published and there is no token-count endpoint. Estimate conservatively (for example chars/3) and measure with `usage.input_tokens`.
- The error status for going over the limit is undocumented. Probably 422 [unverified].
- Jaggedness guidance: accuracy drops as irrelevant state grows ("context rot"), so filter state anyway.

### Schema subtleties from the live OpenAPI (differ from prose docs / SDK / OpenRouter) [spec]

- `instructions` is **optional and nullable** on all three types. The prose docs say "required".
- Noul `criteria.true` / `criteria.false` are each **optional and nullable**. OpenRouter's schema requires both keys.
- Score `criteria` has `minItems: 1` with no `maxItems` in the spec. Its items are string/object/array with **no null**. The TS SDK type `ScoreCriteria` allows `null` entries, and its builder doc says "entries may be `null`". Treat null score levels as invalid (likely 422) [unverified live].
- Choice criteria values may be `null`, meaning the option is "interpreted by its name alone".
- The response schema requires `confidence` and `probabilities` on choice and score answers. On OpenRouter they are optional.
- Error bodies are FastAPI-style: `{"detail":{"error_type":"authentication_error","message":"…"}}`, and 422 uses `detail: [{loc,msg,…}]`. The SDK's `extractMessage` handles both.
- **Missing key → 403** (`"Must supply an API key!"`), **bad key → 401** [probed]. The docs mention only 401. The SDK maps 403 to `PermissionDeniedError`.
- `GET /health` → `{"status":"ok"}` without auth [probed]. Useful for a cheap connectivity check. It is undocumented.
- The API sits behind Cloudflare and Envoy (`server: cloudflare`, `x-envoy-upstream-service-time`, `__cf_bm` cookie).

### Things that do not exist on direct (checked)

- A pricing page, rate-limit page, API changelog, or roadmap page. All of `/pricing`, `/limits`, `/changelog`, `/privacy`, `/security`, and `/roadmap` on docs.typesafe.ai return 404. Pricing and limits live on /models; the only changelogs are the SDK changelogs.
- Idempotency keys, a `user`/metadata field, a seed/temperature, or logprobs.
- An explicit roadmap. The only forward-looking statements are:
  - "Images, audio, and video are not supported (yet)"
  - jaggedness items "will be fixed in later versions"
  - adversarial robustness: "we expect to improve on this in the future"
  - rate limits will stabilize as "upcoming large GPU deals land"
  - the launch blog says image input is "not yet" and that other features are "in the pipeline", with no dates

### Console (console.typesafe.ai)

- **Docs-confirmed pages:**
  - `/keys` (API keys)
  - `/playground`, which supports shareable `#share/<lz-string>` URLs
  - `/decode#share/…` with a `selectedModels` array, which suggests multi-model comparison in the Playground [inferred from the docs' embed component]
  - `/docs/cookbooks`
- **Community-reported sidebar** (flaviocopes, 2026-09-24): Home, Playground, Usage, API Keys, Documentation. Billing setup and a Status link are also mentioned by jev-ai.org.
- **Not documented anywhere I found:** request logs, spend limits or budgets, auto-recharge, key scopes, key expiry or rotation, organizations/teams.
  - flaviocopes: "The TypeSafe docs don't cover key rotation, revocation, expiry, or free credits". Assume a leaked key stays valid until deleted in the console.
  - **Consequence:** we need our own spend guard in the app (count `input_tokens`, apply a local budget).
- Sign-in: Google or email code [community].

---

## 2. Getting an API key now

Timeline, mostly community-sourced from TypeSafe's X posts:

| Date | Event | Sources |
|---|---|---|
| 2026-09-15 | Launch in "early access" with a waitlist. The homepage meta still says "Try … Jev, in early access". | [docs/blog] |
| 2026-09-16 | Big waitlist batch let in. | [community] |
| 2026-09-20 | Waitlist removed. Open signup with **$5 credit** (~120M tokens). | [community: jev-ai.org, explainx] |
| 2026-09-22 06:19 UTC | **Signups paused** ("an immense swell of demand, new signups paused temporarily"). Existing accounts kept working. One source says 09-21. A TypeSafe person said people were "abusing signups to get around rate limits". | [community: jevainews] |
| 2026-09-27 22:30 UTC | **Signups reopened** with more capacity. "New signups no longer get free credits"; TypeSafe hopes to bring them back. | [community: jevainews (updated 09-27), jev-ai.org (09-30)] |

**Current status (2026-09-30): open, no waitlist, no approval step, no free credits for new accounts.** This comes from community reporting of X posts. I could not load console.typesafe.ai myself (Cloudflare 403 to curl), so confirm in a browser.

Procedure:

1. Sign in at https://console.typesafe.ai (Google or email code).
2. Add billing (needed now that there are no free credits) [unverified exact flow].
3. Go to API Keys and create a key. Copy it immediately.
4. Set `TYPESAFE_API_KEY`.
5. Test with `curl https://api.typesafe.ai/v1/models -H "Authorization: Bearer $TYPESAFE_API_KEY"`.

Enterprise (ZDR, higher limits): sales@typesafe.ai.

Fallback if the account is delayed: the Vercel AI Gateway, Cloudflare, or OpenRouter keys, which have separate quotas and were not affected by the pause. Vercel and Pydantic also support **BYOK with a TypeSafe key**, so the same key can be used through a gateway later.

---

## 3. `@typesafe-ai/sdk` usage for our Electron app

Package facts [src, npm]:

- `@typesafe-ai/sdk@0.6.0`, MIT, ESM + CJS + d.ts.
- Node ≥20, zero runtime dependencies. Also on JSR (`jsr.json`).
- Only two versions exist: 0.5.7 (09-12) and 0.6.0 (09-15).
- Breaking change in 0.6.0: score criteria are an array, not an int-keyed map.
- The Python SDK is further ahead (0.7.2: pydantic `response_model`, `extra_body`, a total retry budget, the HTTP/2 extra, gateway examples). **Pin `0.6.0` exactly** and expect churn.

### Client config (`TypeSafeClientConfig`) [src/types.ts, src/client.ts]

| Option | Env fallback | Default | Notes |
|---|---|---|---|
| `apiKey` | `TYPESAFE_API_KEY` | — | **Throws `TypeSafeError` in the constructor if missing.** Construct lazily after loading the key from the OS keychain (safeStorage/keytar). Stored in a private `#apiKey` field, so it is not serialized. |
| `baseURL` | `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | Trailing slashes are stripped; the path `/v1/systemone` is appended. Gateways: OR `https://openrouter.ai/api`, Vercel `https://ai-gateway.vercel.sh/typesafe`, Pydantic `https://gateway-us.pydantic.dev/proxy/typesafe`. |
| `defaultModel` | `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | **Set `jev-1.13.0`** once thresholds are tuned. |
| `timeout` | — | 10 000 ms | **Per attempt; there is no total budget** in TS (Python has one). |
| `retry` | — | see below | Partial overrides are merged and validated. |
| `logLevel` | `TYPESAFE_LOG_LEVEL` | `warn` | `debug` logs **full request bodies** (the screen state), with only the auth header redacted. Keep at `warn`/`info` in production. |
| `logger` | — | console with `[typesafe-sdk]` prefix | Pipe to electron-log. |
| `defaultHeaders` | — | {} | User headers cannot override Authorization, Content-Type, or the SDK headers. |
| `fetch` | — | `globalThis.fetch` | Type `(input: string, init?: RequestInit) => Promise<Response>`. In Electron main, pass `net.fetch` (from `electron`) to get Chromium's network stack: system proxy, PAC, corporate certs. The SDK clones and drains the body (`response.clone().body.getReader()`), so the implementation must support `clone()` and stream bodies. `net.fetch` returns a standard `Response`, so this should work [unverified live]. |
| `dangerouslyAllowBrowser` | — | false | The browser guard checks `window.document` + `navigator`. Electron **main** has neither, so it is fine. A renderer with nodeIntegration **would throw**. Keep the key in main and expose results over IPC. |

Headers sent:

- `Authorization: Bearer …`
- `User-Agent` and `X-TypeSafe-SDK: typesafe-sdk/0.6.0`
- `X-TypeSafe-Runtime: node/<v> (<platform>; <arch>)`
- `X-TypeSafe-Retry-Count: n` on retries

### Default retry policy [src/retry.ts]

```
maxRetries 2, backoffInitialMs 500 (doubling), backoffMaxMs 5000, backoffJitter 0.25 (subtractive),
httpStatuses {408, 429, 500..599}  (includes 529 Overloaded), respectRetryAfter true
(retry-after-ms preferred, then Retry-After seconds/date), maxRetryAfterMs 60000,
apiConnectionError true, apiTimeoutError true
```

- Not retried: 400, 401, 403, 404, 422, and caller aborts.
- Worst case with defaults: 3 × 10 s + ~1.5 s of backoff, or more if a `Retry-After` up to 60 s is honoured. **That is too slow for a UI action loop.**
- For computer use, use something like `timeout: 2500, retry: { maxRetries: 1, backoffMaxMs: 800, maxRetryAfterMs: 1000 }` plus an overall `AbortSignal.timeout(4000)` per step.
- Retrying on connection errors or timeouts can double-bill, because there is no idempotency key. Decisions have no side effects, so only the cost is duplicated.

### Calling `systemOne`

```ts
import { TypeSafeClient, noul, choice, score, APIError, RateLimitError,
         APIConnectionError, APITimeoutError, APIUserAbortError } from "@typesafe-ai/sdk";
import { net } from "electron";

const ts = new TypeSafeClient({
  apiKey, defaultModel: "jev-1.13.0",
  timeout: 2500, retry: { maxRetries: 1, backoffMaxMs: 800, maxRetryAfterMs: 1000 },
  fetch: (url, init) => net.fetch(url, init),
  logger: log, logLevel: "info",
});

const { data, requestId, response } = await ts.systemOne({
  state: { task, screen: axTreeText },
  questions: {
    done:   noul("Has `task` been completed on `screen`?"),
    action: choice("Which element should be clicked next to progress `task`?", candidatesMap), // ≤255
    risk:   score("How risky/destructive is the proposed action?", ["read-only", "reversible", "irreversible"]),
  },
}, { signal: AbortSignal.timeout(4000) }).withResponse();

data.answers.action.choice;        // typed as keyof candidatesMap
data.answers.action.confidence;    // number
data.answers.risk.legend;          // typed tuple indices
data.usage.input_tokens;           // cost = input_tokens * 0.042e-6 USD
data.model;                        // "jev-1.13.0"
```

- `systemOne<const Q>` infers answer types. Choice keys become `keyof T`; score keys become the tuple indices.
- Builders:
  - `noul(instructions?, {true?, false?})`
  - `choice(instructions, map)`, which throws if given an array
  - `score(instructions, [≥2])`, which throws if given a map
- Client-side validation is minimal. It only rejects empty `questions` and score criteria with fewer than 2 entries or not an array. **It does not check** the 255-option or 10-level limits, context size, or null score levels. Add our own pre-validation.
- Extra request properties are forwarded as-is. Vercel uses this for `providerOptions`.
- `APIPromise` methods:
  - `await p` gives the data
  - `.withResponse()` gives `{data, response, requestId}`
  - `.asResponse()` gives the raw `Response`
  - `.map(fn)`
- `ts.models.list()` returns `Promise<ModelCard[]>` (unwraps `{models}`).

### Errors [src/errors.ts]

```
TypeSafeError (config/validation, also base)
├─ APIError {status, headers, body, requestId}
│   ├─ BadRequestError 400, AuthenticationError 401, PermissionDeniedError 403 (missing key!),
│   ├─ NotFoundError 404, UnprocessableEntityError 422 (validation; message joins loc: msg),
│   ├─ RateLimitError 429 {retryAfterMs}, InternalServerError ≥500 (incl. 529)
├─ APIConnectionError (DNS/TLS/closed/interrupted body)
│   └─ APITimeoutError {timeoutMs}
└─ APIUserAbortError (caller signal)
```

Map these to our own neutral error kinds. Log `requestId` (format `req_…`) for support.

---

## 4. Provider-neutral `DecisionModel` interface

Keep TypeSafe's question and answer shapes as the canonical format. Direct TypeSafe, OpenRouter, Vercel `/typesafe`, Pydantic Gateway, Cloudflare (with its envelope), Kev, and Solar Decide all accept them. **Do not leak SDK types into app code.** The adapter file is the only importer of `@typesafe-ai/sdk`.

```ts
// decision/types.ts — no vendor imports
export type Entry = string | { [k: string]: Json } | Json[] | null;
export type Question =
  | { type: "noul";   instructions: Entry; criteria?: { true?: Entry; false?: Entry } }
  | { type: "choice"; instructions: Entry; criteria: Record<string, Entry> }        // ≤ caps.maxChoiceOptions
  | { type: "score";  instructions: Entry; criteria: Exclude<Entry, null>[] };      // 2..caps.maxScoreLevels
export type Answer =
  | { type: "noul";   p: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number | null }
  | { type: "score";  score: number; probabilities: Record<string, number>; confidence: number | null };

export interface DecisionCapabilities {
  contextTokens: number;          // TypeSafe direct 64k; OR/Cloudflare 32k; Kev-4B 8k; Solar 512k
  perQuestionContextTokens?: number; // TypeSafe direct: 32k (state + longest question)
  maxChoiceOptions: number;       // 255
  maxScoreLevels: number;         // 10
  structuredEntries: boolean;
  nullableScoreCriteria: false;
  exactPinning: boolean;          // direct: true
  zdr: boolean;
  reportsCost: boolean;           // direct: false (compute), OR/Vercel: true
}

export interface DecisionResult<A = Record<string, Answer>> {
  answers: A;
  model: string;                  // resolved ID as reported ("jev-1.13.0")
  provider: "typesafe" | "openrouter" | "vercel" | "cloudflare" | "pydantic" | "kev" | "solar" | string;
  requestId?: string;             // x-typesafe-request-id / gen-dec-… / generationId
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
  latencyMs: number;
  calibration: "native" | "logprob" | "verbalized";
}

export type DecisionErrorKind = "auth" | "rate_limit" | "overloaded" | "invalid" | "too_large"
  | "timeout" | "network" | "aborted" | "server" | "unknown";
export class DecisionError extends Error { kind!: DecisionErrorKind; status?: number; requestId?: string;
  retryAfterMs?: number; provider!: string; cause?: unknown }

export interface DecisionModel {
  readonly id: string;             // e.g. "typesafe:jev-1.13.0"
  readonly capabilities: DecisionCapabilities;
  decide(state: Entry, questions: Record<string, Question>,
         opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<DecisionResult>;
  listModels?(): Promise<{ name: string; releaseDate?: string }[]>;
  health?(): Promise<boolean>;     // direct: GET /health
}
```

Adapters:

1. **`TypeSafeSdkModel`**: wraps `TypeSafeClient`. It:
   - maps `noul`→`p`
   - computes `costUsd = inputTokens * 0.042e-6` from a price table kept in config
   - reads `requestId` via `.withResponse()`
   - maps SDK errors to `DecisionError` (403/401 → auth, 429 → rate_limit, 529 → overloaded, 422 → invalid/too_large)

   Because `baseURL` is configurable, the **same adapter covers OpenRouter `/api/v1/systemone`, Vercel `/typesafe`, and Pydantic Gateway** with different keys, model IDs, and capabilities. Only the capabilities and cost source differ. Vercel returns `provider_metadata.gateway.cost` in the body and OR returns `usage.cost`; read them from the raw body when present.
2. **`OpenRouterDecisionsModel`**: raw fetch to `/api/alpha/decisions` (see `openrouter-jev.md`). Only needed for OR extras (`provider.zdr`, `session_id`).
3. **`CloudflareJevModel`**: `{model:"typesafe/jev", input:{state,questions}}` → unwrap `result.result`.
4. **`KevModel` / `SolarDecideModel`**: the same `/v1/systemone` shape (self-hosted Kev, or via OR), with different context caps.
5. **`FallbackDecisionModel(primary, secondary, policy)`**: client-side escalation on errors or low confidence. This matches Vercel's server-side "evaluation fallbacks".

A shared `validateResponse(questions, result)` should check:

- exact answer keys
- choice/score option keys
- probabilities in [0,1] summing to 1 ± 0.02
- choice = argmax

A shared `preflight(questions, caps)` should check option and level caps, reject null score levels, and estimate the token budget.

---

## 5. Gateway comparison (capability differences)

| | TypeSafe direct | OpenRouter | Vercel AI Gateway | Cloudflare Workers AI | Pydantic AI Gateway |
|---|---|---|---|---|---|
| TypeSafe-SDK compatible baseURL | default | `https://openrouter.ai/api` | `https://ai-gateway.vercel.sh/typesafe` (`/v1/systemone`, `/v1/models`) | no (own `/ai/run` envelope) | `https://gateway-us.pydantic.dev/proxy/typesafe` |
| Model ID | `jev-1.13.0` / `jev-latest` / `jev-preview` | `typesafe/jev-1.13`, `~typesafe/jev-latest` | `typesafe-ai/jev` (no version pin found) | `typesafe/jev` (no pin; responses show `jev-1.13.0`) | `jev-latest` |
| Context | 64k / 32k rule | 32k listed | not stated [unverified] | 32,000 | passthrough [unverified] |
| Cost in response | no | `usage.cost` | `provider_metadata.gateway.cost` (+ `generationId`) | no | metered in Logfire |
| Fallbacks | no | no | **yes**: `providerOptions.gateway.models: [{model, when:{question, confidenceBelow}}]`; LLM fallbacks return `confidence:0, probabilities:{}` sentinels; `x-ai-gateway-evaluation-fallback-*` headers | no | no |
| BYOK TypeSafe key | n/a | flagged but undocumented | **yes** (BYOK) | n/a | **yes** (BYOK only) |
| ZDR | enterprise, via sales | `provider.zdr` | `zeroDataRetention` option | "Zero data retention: Yes" | not stated |
| Extras | request-id header, `/health`, Playground | routing, session/trace | unified billing/observability, OIDC auth | cached input listed at $0 | guardrails on state/instructions, unified spend limits; "Streaming and the playground aren't supported" |
| Error shape | `{detail:{error_type,message}}` or 422 list | OR error envelope | `{message, error_type}`; provider errors passed through | CF envelope | [unverified] |

Sources:

- https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe (last updated 2026-09-21)
- https://vercel.com/docs/ai-gateway/models-and-providers/evaluation-fallbacks
- https://developers.cloudflare.com/ai/models/typesafe/jev/
- https://pydantic.dev/articles/jev-pydantic-ai-gateway (2026-09-25)
- https://docs.typesafe.ai/sdk/python/usage (gateway tabs)
- LiteLLM and Venice are also reported as carriers [community, unverified].

---

## 6. Recommendations for our integration

1. Main process only. Construct the client lazily after reading the key from `safeStorage`. Inject `net.fetch`. Pin SDK `0.6.0` and model `jev-1.13.0`.
2. Put a per-step deadline with `AbortSignal` on every call. Tighten timeout and retry settings as in §3. Treat 529 and 429 as "degrade or fallback", not "hang".
3. Budget state to ≤ ~28k tokens by our own estimate, and the total to ≤ ~60k. Log `usage.input_tokens` and `requestId` per call. Keep a local spend counter and cap, since the console has no documented spend limits.
4. Wrap all calls behind `DecisionModel`. Add `TypeSafeSdkModel` configured for OpenRouter or Vercel as the second provider (same code path, different `baseURL`, key, and model).
5. Keep `logLevel` at `warn`/`info`, because `debug` dumps screen state into logs.
6. Re-check before shipping: signup and credits status in a browser, `models.list()` output, the null score-criteria behaviour, the over-context error status, and determinism.

## Unverified items

- Current console signup status and billing flow (community reports only; the console blocked curl).
- Whether `jev-1.13` (without the patch number) is accepted. The docs' jaggedness example uses `model="jev-1.13"`.
- The status code for requests over the context limit, and whether OpenRouter enforces 32k total.
- `net.fetch` compatibility with the SDK's `clone()`-and-drain buffering.
- Vercel and Pydantic context limits; Vercel version pinning.
- Jev determinism (FAQ answer not readable) and console features beyond Home/Playground/Usage/API Keys.
- Default (non-ZDR) retention period for API inputs.
