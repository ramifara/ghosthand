# Jev via OpenRouter: research notes

Researched 2026-09-30. Sources are OpenRouter's public docs, its public Models/Endpoints APIs (queried with curl, no key), TypeSafe docs, Vercel and Cloudflare docs, and community repos. No authenticated API calls were made, so nothing here comes from a live Jev response I ran myself. Status labels:

- **[verified]**: read directly from an official doc or public API response on 2026-09-30.
- **[probed]**: checked by sending an unauthenticated request (401 means the route exists, 404 means it does not).
- **[community]**: comes from third-party code or articles.
- **[unverified]**: could not be confirmed.

---

## 1. OpenRouter model listings

### Slugs [verified]

Source: `GET https://openrouter.ai/api/v1/models?output_modalities=decisions` and `/api/v1/models/{slug}/endpoints`.

| Slug | What it is | Notes |
|---|---|---|
| `typesafe/jev-1.13` | Pinned Jev 1.13 | Endpoint name `TypeSafe \| typesafe/jev-1.13-20260917`. Upstream `provider_model_id` is `jev-1.13.0`. Responses report `model: "typesafe/jev-1.13-20260917"`. |
| `~typesafe/jev-latest` | Alias for the newest Jev | Modality `text->decisions`, tokenizer "Router", no endpoints of its own (it redirects). OpenRouter docs say you can use it (https://openrouter.ai/docs/guides/community/jev-tutorial). Note the leading `~`. `typesafe/jev-latest` and `typesafe/jev` return 404. |
| `typesafe/jev-router` | A different product | A chat-completions model router that uses Jev to pick a model and reasoning effort. 1M context, variable pricing (`-1`). Not a decision endpoint. https://openrouter.ai/docs/guides/routing/routers/jev-router |

Other details:

- Page: https://openrouter.ai/typesafe/jev-1.13 (curl returns 200; WebFetch returned 404 because the page is JS-rendered). Author page: https://openrouter.ai/typesafe
- **Gotcha:** the default `GET /api/v1/models` does **not** list `typesafe/jev-1.13` or `~typesafe/jev-latest`. It lists only `typesafe/jev-router`. Use `?output_modalities=decisions` or `?output_modalities=all` to see decision models.
- `created` timestamp for jev-1.13 is 2026-09-18, which matches reports that OpenRouter added Jev three days after TypeSafe's 2026-09-15 launch.

### Endpoint facts for `typesafe/jev-1.13` [verified]

Source: `/api/v1/models/typesafe/jev-1.13/endpoints`.

- **Provider:** only one, `TypeSafe` (tag `typesafe`), so there is no multi-provider redundancy.
- **Pricing:** prompt `0.000000042` ($0.042/M input tokens), completion `0` (output free), discount 0. Each response includes `usage.cost` in USD.
  - Example: 476 input tokens cost $0.000019992.
- **Context length:** 32,000. `max_completion_tokens` shows 28,800, a placeholder with no real meaning for decisions.
  - TypeSafe direct allows "64k tokens per request; 32k tokens for state plus the longest question" (https://docs.typesafe.ai/models).
  - OpenRouter's docs say "32,000 tokens. That's the state you send plus the questions."
  - **[unverified]** Whether OpenRouter enforces 32k on the whole request (stricter than direct) or passes the request through to TypeSafe's 64k/32k rule. Plan for 32k total to be safe.
- **`supported_parameters`:** `[]`. **`supports_implicit_caching`:** `false`. There is no cache pricing line.
- **Latency/throughput:** OpenRouter publishes no numbers. `latency_last_30m` and `throughput_last_30m` are `null`, and the page charts load client-side.
- **Uptime:** 100% (5m/30m/1d) at query time.
- **Data policy** (from embedded page JSON): `training:false`, `retainsPrompts:false`, `canPublish:false`, `requiresUserIDs:false`, `moderationRequired:false`.
  - `typesafe/jev-1.13` **is in** OpenRouter's ZDR endpoint list (`GET https://openrouter.ai/api/v1/endpoints/zdr`), so `provider.zdr: true` should still route. **[verified list membership; not live-tested]**
- **BYOK:** the provider record embedded in the page has `"byokEnabled": true` (adapter `TypeSafeDecisionsAdapter`).
  - **[unverified]** end to end. No OpenRouter doc says a TypeSafe key can be attached for the Decisions API.
  - General BYOK rules: BYOK endpoints are always tried first, and the fee is 5% after the free threshold (https://openrouter.ai/docs/guides/overview/auth/byok).
- **Early access / approval:** not needed on OpenRouter.
  - Docs: "There's no waitlist or separate TypeSafe account. Just create an OpenRouter API key" (https://openrouter.ai/docs/guides/community/jev).
  - TypeSafe direct was reportedly invite/early-access at launch (2026-09-15) and opened around 2026-09-21 [community: marktechpost, openrouter blog]. Some repos cite OpenRouter or Cloudflare as a way to get "access without a TypeSafe invite" (e.g. clouatre-labs/decisions-judge-mcp#40).

### Rate limits

- **OpenRouter:** publishes no per-model limit for paid models. Its limits page covers free-model caps and DDoS protection only. A 429 can also come from the upstream provider, with `error.metadata.provider_code` (https://openrouter.ai/docs/api_reference/limits). **[verified: no Jev-specific number exists]**
- **TypeSafe upstream:** "100K tokens per second / 40 requests per second", "adjusting dynamically … can change without notice" (https://docs.typesafe.ai/models). [verified]
  - An older article quoted 250k tok/s and 1,200 RPM (https://dryhurst.io/articles/jev-openrouter-decisions-api/). That figure is outdated.
  - **[unverified]** Whether OpenRouter's traffic to TypeSafe shares one pooled limit or is per customer.

### Measured latency [community]

- Via OpenRouter: 354 ms for a 3-question text triage, 340–530 ms for other workloads, end to end including network, measured 2026-09-23 (https://dryhurst.io/articles/jev-openrouter-decisions-api/).
- Direct TypeSafe:
  - browser-use/jev-ultrafast: median 178 ms over 17 requests (https://github.com/browser-use/jev-ultrafast, docs/performance.md).
  - awlevin/typesafe-computer-use: "0.13 to 0.38 s".
  - TypeSafe's marketing figure: roughly 70–500 ms.
- Expect OpenRouter to add a hop (tens to low hundreds of ms). jkudish/jev-mcp says: "The endpoint is alpha and adds a hop … Direct TypeSafe remains the recommended default."

---

## 2. API shape on OpenRouter

### It is not chat completions [verified]

Jev has its own endpoints. The docs say it "is not a drop-in replacement for a chat model."

- The OpenAI SDK chat or responses methods do not apply.
- **[unverified]** What `/api/v1/chat/completions` with `model: typesafe/jev-1.13` returns. I had no key to test it. The embedded provider record says `hasChatCompletions: true`, but nothing documents chat usage. Assume it fails.

### Two surfaces with the same body and response schema [verified + probed]

| Surface | URL | Probe | Use |
|---|---|---|---|
| Decisions API (alpha) | `POST https://openrouter.ai/api/alpha/decisions` | 401 (exists) | Plain HTTP; OpenRouter TS/Python/Go SDK `alpha.decisions.create`; `@openrouter/ai-sdk-provider` |
| System One API | `POST https://openrouter.ai/api/v1/systemone` | 401 (exists) | TypeSafe SDKs with `baseURL: "https://openrouter.ai/api"`. Bare IDs `jev-1.13` and `jev-latest` map to `typesafe/…` |

- Docs: https://openrouter.ai/docs/guides/community/jev, API ref https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request, https://openrouter.ai/docs/api/api-reference/systemone/submit-a-system-one-request, SDK guide https://openrouter.ai/docs/guides/community/typesafe-sdk
- **Doc bug:** the OpenAPI spec joins server `https://openrouter.ai/api/v1` with path `/api/alpha/decisions`, and the rendered reference shows `https://openrouter.ai/api/v1/api/alpha/decisions`. That URL returns **404**. `/api/v1/alpha/decisions` also returns 404. The working URL is `https://openrouter.ai/api/alpha/decisions`.
- Auth: `Authorization: Bearer sk-or-...`. The optional attribution headers `HTTP-Referer`, `X-Title` / `X-OpenRouter-Title` are used by community code.

### Request body (`DecisionsRequest`) [verified]

It passes TypeSafe's `{model, state, questions}` through unchanged, plus some OpenRouter extras:

```jsonc
{
  "model": "typesafe/jev-1.13",            // or "~typesafe/jev-latest"
  "state": "string" | {…} | […],           // text/JSON only
  "questions": {
    "<id>": { "type": "noul",   "instructions": str|obj|arr,
              "criteria": { "true": …, "false": … } },       // criteria optional; if present, BOTH keys required
    "<id>": { "type": "choice", "instructions": …,
              "criteria": { "<option>": str|obj|arr|null, … } },  // required
    "<id>": { "type": "score",  "instructions": …,
              "criteria": [ level0, level1, … ] }            // required, ordered low→high, no nulls
  },
  // OpenRouter extras:
  "provider": { ProviderPreferences },     // order/only/ignore/allow_fallbacks/data_collection/zdr/max_price/sort/…
  "session_id": "≤256 chars",              // observability only, not sent upstream
  "user": "≤256 chars",
  "trace": { trace_id, trace_name, span_name, generation_name, parent_span_id, … }
}
```

- There is **no** `models` fallback array (unlike chat completions), so OpenRouter cannot fall back from one decision model to another. Do that in your own code.
- Limits the OpenRouter schema does not encode, but TypeSafe enforces (https://docs.typesafe.ai/api):
  - Choice: at most 255 options.
  - Score: at least 2 levels ("should") and at most 10 ("API accepts up to 10"). OpenRouter's schema says `minItems: 1`.
  - How upstream 422s surface through OpenRouter (400 vs 502) is **[unverified]**.
- `@openrouter/ai-sdk-provider` says the Decisions API rejects `score` criteria that contain `null`, and `noul` criteria that describe only one of true/false (https://github.com/OpenRouterTeam/ai-sdk-provider README).
- Question IDs are not sent to the model. Only `instructions`/`criteria` are. Structured JSON in instructions/criteria is supported, with backtick references to state or instruction fields (https://docs.typesafe.ai/primitives/advanced).
- All questions in one request are answered in parallel against one ingest of `state` and cannot see each other's answers. Batching is much cheaper and faster than separate calls (TypeSafe cookbook: 12.2× cheaper, 10× faster for 13 questions).

### Response (`DecisionsResponse`) [verified]

This is TypeSafe's shape plus `id`, `provider`, and `usage.cost`:

```json
{
  "id": "gen-dec-1790015143-AIaTutprXsJ5EwohRSjb",
  "model": "typesafe/jev-1.13-20260917",
  "provider": "TypeSafe",
  "answers": {
    "is_bug":  { "type": "noul", "noul": 0.96 },
    "team":    { "type": "choice", "choice": "payments", "confidence": 0.67,
                 "probabilities": { "payments": 0.78, "frontend": 0.22, "account": 0 } },
    "urgency": { "type": "score", "score": 1.99, "confidence": 0.99,
                 "probabilities": { "0": 0, "1": 0, "2": 1 },
                 "legend": { "0": "Can wait…", "1": "Should be fixed…", "2": "Blocking revenue…" } }
  },
  "usage": { "input_tokens": 476, "output_tokens": 70, "cost": 0.000019992 }
}
```

- `noul` is P(yes) and has no confidence field.
- Choice and Score carry `confidence`. The confidence explorer's source code in TypeSafe's docs (https://docs.typesafe.ai/confidence) computes it as `(n·p_max − 1)/(n − 1)` clamped to [0,1]. The published examples match this: 0.78/0.22/0 gives 0.67, and 0.84/0.16/0 gives 0.76 vs the reported 0.75, a rounding difference.
- A score is a probability-weighted index. Level 0 is the first criterion.
- Probabilities and scores are **rounded to 2 decimals** by the Decisions API (per the ai-sdk-provider README). Sums can be off by about 0.01.
- In the OpenRouter schema, `confidence` and `probabilities` are marked optional. Validate their presence rather than assuming it.

### Code that works with OpenRouter [verified from docs]

- **curl / fetch / requests:** copy-pasteable in the Jev tutorial (https://openrouter.ai/docs/guides/community/jev-tutorial). POST the JSON above to `https://openrouter.ai/api/alpha/decisions`.
- **OpenRouter SDKs:**
  - TS: `new OpenRouter({apiKey}).alpha.decisions.create({ decisionsRequest: {model, state, questions} })` (`@openrouter/sdk`).
  - Python: `OpenRouter(api_key=…).alpha.decisions.create(model=…, state=…, questions=…)`.
  - Go: also available.
  - Refs: https://openrouter.ai/docs/client-sdks/typescript/sdks/decisions/README, …/python/…, …/go/…
- **TypeSafe SDK:** `new TypeSafeClient({ apiKey: OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api" })`, then `client.systemOne({model:"jev-1.13", state, questions})`. Python: `TypeSafeClient(api_key=…, base_url="https://openrouter.ai/api")`.
  - Env vars `TYPESAFE_API_KEY` and `TYPESAFE_BASE_URL` also work.
  - Caveat: `client.models.list()` is rejected. Use OpenRouter's Models API instead.
- **AI SDK:** `@openrouter/ai-sdk-provider` **3.1.0** adds `openrouter.decisionModel('typesafe/jev-1.13')` (alias `evaluationModel`) for `experimental_evaluate` from `ai@7.0.103+`.
  - Type mapping: AI SDK `boolean` becomes `noul`, and the answer comes back as `probability`.
  - `confidence`, `legend`, and `cost` are placed under `result.providerMetadata.openrouter`.
  - The Decisions URL is derived from `baseURL` by replacing `/v1` with `/alpha`, or set explicitly with `decisionsBaseURL`.
  - https://github.com/OpenRouterTeam/ai-sdk-provider (README "Evaluation", CHANGELOG 3.1.0 / PR #562)
- **OpenAI SDK:** not usable, beyond calling a generic raw `post()`.

### Community repos

| Repo | Transport | Takeaway |
|---|---|---|
| jkudish/jev-mcp (`src/provider.ts`) + jkudish/jev-agent-tools (`src/transports/*.ts`) | TypeSafe direct (default), **OpenRouter** `https://openrouter.ai/api/alpha/decisions`, Cloudflare, Vercel, "compatible" | Best reference for a multi-provider abstraction. OpenRouter driver maps `jev-latest` to `typesafe/jev-1.13` (written before `~typesafe/jev-latest` existed). Retries only on 408/409/429/5xx with jittered backoff and a whole-request deadline. Never retries ambiguous network errors (no idempotency key, so a retry could double-bill). Validation: exact answer IDs and option keys, probabilities in [0,1] summing within 0.01, choice = argmax within 0.001. |
| browser-use/jev-ultrafast (`jev_ultrafast/model.py`) | TypeSafe direct `api.typesafe.ai/v1/systemone` | Uses OpenRouter only for the text-writing helper LLM (`inception/mercury-2.5`). Asks one `choice` for the operation plus one `choice` per operation's targets in a single call. Retries 429/529/503. Median Jev latency 178 ms. |
| awlevin/typesafe-computer-use | TypeSafe direct | OCR screen, then a Jev choice, then click. Model latency 0.13–0.38 s. No OpenRouter. |
| cooper667/jev-playwright (`runner/engine/jev.ts`) | Cloudflare Workers AI | noul + choice only. Good TS typing pattern (`AnswerFor<Q>` conditional types). |

### Comparison with other carriers

| | OpenRouter | Vercel AI Gateway | Cloudflare Workers AI | TypeSafe direct |
|---|---|---|---|---|
| Model ID | `typesafe/jev-1.13`, `~typesafe/jev-latest` | `typesafe-ai/jev` | `typesafe/jev` (single alias, no pinning) | `jev-1.13.0`, `jev-latest`, `jev-preview` |
| Endpoint | `POST /api/alpha/decisions`; `POST /api/v1/systemone` | AI SDK `experimental_evaluate`; `POST https://ai-gateway.vercel.sh/v1/evaluate`; TypeSafe-compatible `POST https://ai-gateway.vercel.sh/typesafe/v1/systemone` | `POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run` with body `{model, input:{state,questions}}`, or `env.AI.run()` | `POST https://api.typesafe.ai/v1/systemone` |
| Yes/no type | `noul` (answer `noul`) | `boolean` (answer `probability`) on evaluate; `noul` on the /typesafe path | `noul` | `noul` |
| Confidence | in answer | evaluate: in `providerMetadata` (jev-agent-tools reads `providerMetadata.typesafe.confidence`); /typesafe path: in answer | in answer | in answer |
| Envelope | TypeSafe + `id`, `provider`, `usage.cost` | `usage.inputTokens`, `providerMetadata.gateway.cost` | double-nested `result.result` (+ `result.state`) | TypeSafe |
| Context | 32k (listed) | not checked | 32k (listed) | 64k total / 32k state + longest question |
| ZDR | `provider.zdr:true`; Jev is in the ZDR list | `providerOptions.gateway.zeroDataRetention` | "Zero data retention" stated | Enterprise ZDR |
| Extras | provider routing, `session_id`, `trace` | **evaluation fallbacks**: rerun on low confidence with another eval model or an LLM via structured output; LLM answers return sentinels `confidence:0, probabilities:{}` | cached input $0 listed | — |

Sources:

- Vercel: https://vercel.com/docs/ai-gateway/modalities/evaluation, https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe, https://vercel.com/docs/ai-gateway/getting-started/evaluation, https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway
- Cloudflare: https://developers.cloudflare.com/ai/models/typesafe/jev/
- jev-agent-tools' Vercel driver posts to an undocumented `https://ai-gateway.vercel.sh/v4/ai/evaluation-model` with `ai-model-id` headers. That is AI SDK internals. Use the documented `/v1/evaluate` instead.

---

## 3. Substitutes and fallbacks

### Other decision-modality models on OpenRouter [verified]

Source: `?output_modalities=decisions`, 7 IDs.

| Slug | Maker / provider | Price in/out | Context | Schema | Notes |
|---|---|---|---|---|---|
| `upstage/solar-decide` | Upstage (2 endpoints, one tagged `upstage/zdr`) | $0.05/M, discount 0.5 listed; cache read $0.05/M; out 0 | 512K (524,288) | "Same /v1/systemone schema as Jev"; choice, score, yes/no | Built on Solar Mini 4, strong Korean. In the ZDR list. The ZDR endpoint's dataPolicy says `retainsPrompts:true` (odd, recheck). BYOK+ZDR needs a ZDR-enabled Upstage org. Added 2026-09-28. |
| `jaredpalmer/kev-4b` | SiliconFlow (fp8) | $0.042/M, out 0 | 8,192 | Same `TypeSafeDecisionsAdapter`; noul/choice/score | Open weights (Apache-2.0) on Qwen3.5-4B-Base. Self-hostable with the same API (https://github.com/jaredpalmer/kev). Its README reports Jev accuracy 0.857 vs Kev-27B 0.851, with Kev-4B/9B within about 4 points on "new sources". Small context. In the ZDR list. |
| `respan/span-01`, `respan/span-01-lite`, `respan/span-01-lite:free` | Respan | $0.02/M; lite free | 0 (unlisted) | `RespanDecisionsAdapter` (different adapter) | "Behavior scoring": P(behavior present) per plain-language behavior, i.e. noul-like. Whether choice/score are supported is **[unverified]**. `retainsPrompts:true`. Not in the ZDR list. BYOK disabled. |

Because Solar Decide and Kev share the Decisions schema, **swapping between them should be a `model` string change** on `/api/alpha/decisions`. Not live-tested. Watch their different context limits.

Classifier-style chat models that are **not** typed-decision models: `meta-llama/llama-guard-4-12b` and `openai/gpt-oss-safeguard-20b` (safety). Neither returns calibrated per-option probabilities natively.

### Emulating Jev with a small LLM on OpenRouter

OpenRouter supports `response_format: {type:"json_schema", strict:true}` and `logprobs` + `top_logprobs` (0–20), but **per endpoint**, not per model. You must set `provider: { require_parameters: true }` or requests may land on a provider that ignores logprobs. Docs: https://openrouter.ai/docs/api/reference/parameters, https://openrouter.ai/docs/guides/features/structured-outputs

Per-endpoint support, checked via `/endpoints`:

| Model (input $/M) | Endpoints with logprobs + top_logprobs + structured_outputs |
|---|---|
| `openai/gpt-4o-mini` ($0.15 in / $0.60 out) | OpenAI, Azure (all) |
| `mistralai/mistral-nemo` ($0.018–0.04) | DekaLLM, Parasail, Novita (not DeepInfra or Mistral) |
| `openai/gpt-oss-20b` ($0.018–0.04) | Darkbloom, AkashML, DekaLLM, CoreWeave, Parasail, Novita. It is a reasoning model, so disable or minimize reasoning; logprobs cover the final tokens. |
| `qwen/qwen3-30b-a3b-instruct-2507` ($0.048–0.09) | StreamLake, DekaLLM |
| `meta-llama/llama-3.1-8b-instruct` | only CoreWeave has both (Novita has logprobs only; Groq neither) |
| `google/gemma-3-27b-it` | Parasail only |

- No logprobs on OpenRouter: `openai/gpt-6-luna`, `gpt-5.6-luna`, `gpt-4.1-nano`, `gpt-4.1-mini`, `google/gemini-2.5-flash-lite`, `inception/mercury-2.5`. These support structured outputs only, so probabilities would have to be verbalized (poorly calibrated).
- OpenRouter's public API gave no per-endpoint latency numbers (`null`). Measure it yourself. Expect 200–800 ms TTFT-dominated for a one-token answer on fast providers, which is generally slower and costlier per call than Jev ($0.042/M input with free output; an LLM also bills prompt tokens at 0.02–0.15 $/M plus a few output tokens).

Emulation recipe that yields Jev-shaped answers:

1. One chat call per question, run in parallel, with the shared `state` in a system message. Use a stable prefix so providers with prompt caching can reuse it.
2. Force a **single-token answer**:
   - noul: `"Y"`/`"N"`
   - choice: map options to single-token labels `A…T`
   - score: digits `0…9`
   
   Use `max_tokens: 1`, `temperature: 0`, `logprobs: true`, `top_logprobs: 20`, and optionally `logit_bias` to restrict the vocabulary.
   - Structured outputs with an enum also work, but the label's logprobs sit inside JSON tokens. Single-token mode is simpler and cheaper.
3. Take the softmax over the logprobs of the allowed labels and renormalize. Labels missing from top-20 get 0 (or ε).
   - noul = P(Y)/(P(Y)+P(N))
   - choice = argmax, with confidence `(n·pmax−1)/(n−1)` to match TypeSafe
   - score = Σ i·p_i, same confidence formula
4. Limits:
   - `top_logprobs ≤ 20` caps logprob-based choice at 20 options. Jev allows 255. For more options, use a tournament (shortlist in chunks of 20, then a final round) or verbalized probabilities with `probabilities: null`.
   - Score's 10-level maximum fits the digits 0–9 exactly.
   - Tokenization of "A"/" A" varies by model; match both.
   - Mark the calibration source as `"logprob"` so thresholds are tuned separately from Jev.

### Proposed provider-neutral interface

Use TypeSafe's question and answer schema as the canonical types. It is already what OpenRouter, Cloudflare, Kev, Solar Decide, and Vercel's `/typesafe` path accept. Adapters translate only at the edges.

```ts
type Entry = string | Record<string, unknown> | unknown[];
type Question =
  | { type: "noul";   instructions: Entry; criteria?: { true: Entry; false: Entry } }
  | { type: "choice"; instructions: Entry; criteria: Record<string, Entry | null> } // ≤255
  | { type: "score";  instructions: Entry; criteria: Entry[] };                     // 2..10, low→high

type Answer =
  | { type: "noul";   p: number }                                                   // P(yes)
  | { type: "choice"; choice: string; probabilities: Record<string, number> | null; confidence: number | null }
  | { type: "score";  score: number; probabilities: Record<string, number> | null; confidence: number | null };

interface DecisionResult<Q extends Record<string, Question>> {
  answers: { [K in keyof Q]: Answer & { type: Q[K]["type"] } };
  model: string;                 // resolved/dated snapshot
  provider: string;              // "openrouter:TypeSafe", "typesafe", "llm:openai/gpt-4o-mini", …
  calibration: "native" | "logprob" | "verbalized";
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
  latencyMs: number;
  raw?: unknown;
}

interface DecisionCapabilities {
  questionTypes: Array<"noul" | "choice" | "score">;
  maxChoiceOptions: number;      // Jev 255, logprob-LLM 20
  maxScoreLevels: number;        // 10
  contextTokens: number;         // Jev@OR 32k, Solar 512k, Kev-4B 8k
  structuredEntries: boolean;    // object/array instructions/criteria
  zdr: boolean;
}

interface DecisionModel {
  readonly id: string;
  readonly capabilities: DecisionCapabilities;
  ask<Q extends Record<string, Question>>(
    state: string | object | unknown[],
    questions: Q,
    opts?: { signal?: AbortSignal; timeoutMs?: number; zdr?: boolean; sessionId?: string },
  ): Promise<DecisionResult<Q>>;
}
```

Adapters:

1. **`SystemOneHttpModel`**: one class covering OpenRouter `/api/alpha/decisions` (`typesafe/jev-1.13`, `~typesafe/jev-latest`, `upstage/solar-decide`, `jaredpalmer/kev-4b`, and future `output_modalities=decisions` models), TypeSafe direct, Vercel `/typesafe/v1/systemone`, and self-hosted Kev. Configured with a URL, key, model string, and envelope quirks.
2. **`CloudflareJevModel`**: wraps the body as `{model, input}` and unwraps `result.result`.
3. **`LlmLogprobDecisionModel`**: the OpenRouter chat-completions emulation above. It sets `require_parameters: true` and reports `calibration: "logprob"`.
4. **`FallbackDecisionModel(primary, secondary, policy)`**: client-side escalation such as "if confidence < x or noul ∈ [a,b], re-ask secondary." This mirrors Vercel's gateway fallbacks, which OpenRouter's Decisions API lacks (no `models` array).

Validate every response the way jev-agent-tools does before acting on it:

- exact question IDs and option keys
- probabilities finite, in [0,1], summing to 1 ± 0.02 (the 2-decimal rounding)
- choice equals the argmax

Treat missing or invalid answers as "no decision". Never silently default.

---

## 4. Gotchas checklist

1. **Wrong URL in OpenRouter's API reference**: `…/api/v1/api/alpha/decisions` returns 404. Use `https://openrouter.ai/api/alpha/decisions`, or `https://openrouter.ai/api/v1/systemone` for TypeSafe SDKs.
2. **The endpoint is alpha**: the request and response shape may change. Pin SDK versions and validate responses.
3. **`~` prefix on the alias**: `~typesafe/jev-latest`. Pin `typesafe/jev-1.13` when thresholds are tuned. Responses echo a dated snapshot, `typesafe/jev-1.13-20260917`. Log it.
4. **Models list omits Jev by default**: use `?output_modalities=decisions`.
5. **Context 32k on OpenRouter vs 64k direct**: budget for 32k.
6. **Single provider, no model fallbacks**: `provider.allow_fallbacks`, `order`, and so on are accepted but there is only TypeSafe behind it. Handle 429, 502, 503, 524, and 529 (provider overloaded) with jittered backoff, and fail over in your own code.
   - Documented codes: 400, 401, 402 (credits), 403, 404, 413, 429, 500, 502, 503, 524, 529.
   - Upstream TypeSafe codes: 401, 422 (validation), 429, 529.
   - Don't retry ambiguous network failures blindly. There is no idempotency key, so a retry can double-bill (cost is tiny, but the side effects may not be).
7. **ZDR / data**: Jev on OpenRouter is `training:false`, `retainsPrompts:false`, and in the ZDR endpoint list. `provider: { zdr: true, data_collection: "deny" }` is accepted by the schema.
   - Per-request `zdr` can only tighten account settings.
   - OpenRouter's own prompt logging is an account privacy setting; check https://openrouter.ai/settings/privacy.
   - `session_id` and `trace` stay on OpenRouter and are never sent to the provider.
8. **Caching**: no implicit caching and no cache price for Jev on OpenRouter. Batch all questions for one state into one request instead; that is how Jev amortizes the state.
9. **Question types**: all three (noul, choice, score) and structured object/array `instructions`/`criteria` are in OpenRouter's schema and documented examples.
   - Upstream limits of 255 options and 2–10 score levels still apply.
   - Pre-validate client-side: no nulls in score criteria; noul criteria need both true and false.
10. **Rounding**: probabilities and scores come back at 2 decimals. Tiny tails round to 0.
11. **Question IDs are invisible to the model**: put all meaning in `instructions`/`criteria`.
12. **Text only**: images, audio, and PDF must be converted first (OCR / accessibility tree for computer use). English is best.
13. **Jev 1.13 weak spots**: literal reading, math/counting, dates, indirection, and large irrelevant state. Filter state and keep arithmetic in code (https://docs.typesafe.ai/model-jaggedness/jev-1.13).
14. **BYOK** for TypeSafe on OpenRouter: flagged enabled in page data, but not documented or tested.
15. **Latency**: OpenRouter adds a hop, and no official per-model latency is published. Measure p50/p95 on your own workload before committing. Community numbers are about 350–530 ms via OpenRouter vs about 130–380 ms direct.

## Unverified items

- Live behavior of any authenticated call (no key used), including chat-completions rejection, 32k enforcement, how 422s map through OpenRouter, BYOK, and actual latency.
- Whether OpenRouter's TypeSafe capacity is pooled across customers.
- Respan Span-01 question-type support and schema details.
- Why the Upstage ZDR endpoint's dataPolicy shows `retainsPrompts:true`.
