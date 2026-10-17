<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# Jev 1.14, image input and `box` questions: research notes

Researched 2026-10-17. Companion to `typesafe-direct.md` (2026-09-30), which still holds for text requests. Sources:

- `@typesafe-ai/sdk@0.7.0` (published 2026-10-14): the npm tarball's `dist/index.mjs` and `dist/index.d.mts`, and its README and changelog
- the live OpenAPI spec at `https://api.typesafe.ai/openapi.json` (still version 0.2.0, now with `Asset`, `BoxQuestion`, `BoxAnswer` and a `multipart/form-data` request body)
- docs.typesafe.ai pages `images`, `primitives/box`, `models`, `api`, `confidence`, the JS and Python SDK changelogs
- community write-ups of the 2026-10-14 release (MarkTechPost, explainx, remio, madewithjev, LiteLLM blog)
- **a live probe with the project's key** (`/tmp/jev-img-probe`, 2026-10-17, 34 calls, 34k input tokens, $0.0014) against screenshots of the GhostHand desktop app

Labels: **[docs]** official docs, **[spec]** OpenAPI, **[src]** SDK source, **[probed]** measured live, **[community]** third-party, **[unverified]**.

---

## 0. TL;DR

- **Jev 1.14.0 shipped 2026-10-14** as `jev-preview`. `jev-latest` still answered as `jev-1.13.0` on 2026-10-17 and is announced to move to 1.14.0 about a week after release. Deprecation policy: 60 days' notice for 1.13.0, 30 days for 1.14.0 [community]. Our pin `jev-1.13.0` keeps working.
- **Images are in.** PNG or JPEG, sent as `assets` referenced from `state`, `instructions` or `criteria`, on **both** 1.13 and 1.14, behind the opt-in header `TypeSafe-Danger-Zone-Images: true`. Without the header: `400 "Images are experimental. Send the header TypeSafe-Danger-Zone-Images: true to use them."` [probed].
- **New `box` question** (1.14 only): "where is X in the image" → `{top, bottom, left, right}` as fractions of the image, plus `confidence` (nullable in the schema, always a number in our probe). On `jev-1.13.0` a box question is `400 api_usage_error "Invalid request."` [probed].
- **Long context** behind `TypeSafe-Danger-Zone-Long-Context: true`: 262k per request and per question, same price, "slower and less accurate" [docs].
- TypeSafe calls all three "danger zone" features **not production-ready** ("way too much jaggedness"); formats, limits and accuracy may change between releases [docs].
- **Measured on UI screenshots [probed]:** box answers for a button, a sidebar entry and a dropdown were within ~1–2% of the true edges; an absent target returned confidence 0.08 and the paired noul returned 0.01. Latency with an image is 215–510 ms, the same band as text. Image tokens ≈ `240 + width×height / 385` (a 1280×834 screenshot ≈ 3.0k tokens ≈ $0.00013; 1568×1022 ≈ 4.4k).
- **SDK 0.7.0** is a breaking bump: Node ≥ 22, request payload types no longer exported, zstd compression by default (Node ≥ 22.15), image/`box`/`withAssets` APIs, `usage` token counts nullable, invalid requests now reject the promise instead of throwing.

---

## 1. API changes [spec, docs]

### Request

```jsonc
POST /v1/systemone
Content-Type: application/json | multipart/form-data
TypeSafe-Danger-Zone-Images: true            // required when assets or box questions are present
TypeSafe-Danger-Zone-Long-Context: true      // optional, 262k limits

{
  "model": "jev-1.14.0",
  "state": { "goal": "…", "screen": "<img:1>", "elements": "…" },
  "questions": {
    "target": { "type": "choice", "instructions": "… `screen` …", "criteria": { "e1": null, "none": "…" } },
    "where":  { "type": "box",    "instructions": "The Save button in `screen`" }
  },
  "assets": { "<img:1>": { "type": "image", "format": "png", "data_base64": "…" } }
  //        or { "<img:1>": { "type": "image", "part": "screen" } } in a multipart request
}
```

- `assets`: a map from an opaque placeholder to an image. The placeholder is replaced **wherever it appears as or inside a string** in `state`, `instructions` or `criteria`; object keys are not replaced. Every asset must be referenced, otherwise 400. **Each use sends the image again** and counts again toward context, so put a shared image in `state` once and refer to it by backtick path from each question (`` `screen` ``). Reference limits: 1,024 bytes per reference, 65,536 bytes total [docs].
- Multipart (recommended): JSON in a part named `request` (`application/json`); each image in its own file part (`image/png`, `image/jpeg`, `application/octet-stream` or no type); each file part belongs to exactly one asset. Base64 in JSON also works (about a third larger) [docs].
- `box` question: `{type:"box", instructions?: Entry}`; no `criteria`. Always returns a box, even when the target is absent [docs, probed]. One target per question. Mixes freely with the other types and shares the state.
- Image limits (inclusive; out-of-range is rejected, never resized): PNG or JPEG, still only; **16 MiB per image; width and height 280–1568 px each; 78,400–2,458,624 total pixels; 32 MiB request body; 32 MiB for all images after processing; 32 MiB expanded request.** Metadata is stripped; EXIF orientation is **not** applied [docs]. Probe: 1600×1043 → `400 "Invalid image dimensions."`; 280×280, 400×300, 640×280, 280×640 and 1568×280 all accepted [probed]. (One community page says 256 px minimum; the docs say 280 and the probe did not test between.)
- Errors: `400` images not enabled / invalid or unreferenced asset / bad base64 or format / broken multipart / `max_tokens_exceeded`; `413` a size limit; `415` bad `Content-Encoding`; `422` validation. If any image fails the whole request fails, no partial answers [docs].
- Pricing: images are billed as input tokens at $0.042/M, no per-image fee; tokens appear in `usage.input_tokens`. No published estimate formula ("guidance is coming") [docs].
- `GET /v1/models` still lists aliases only: `jev-latest` and `jev-preview` [probed].
- No image rate limits beyond the normal ones. Rate limits are now "per organization, shown in the console" with no public numbers [docs].

### Response

- `BoxAnswer {type:"box", box:{top,bottom,left,right}, confidence: number|null}`; each coordinate is "the expected value of its edge's predicted position" [spec]. Vertical from the top, horizontal from the left, fractions of the image's height and width.
- `usage.input_tokens` and `output_tokens` may be `null` (SDK 0.7.0 type) [src].

### Confidence [docs]

- Choice and score confidence are derived from the probability distribution (score confidence also weighs distance between levels). Nouls carry uncertainty in `p` itself; `|2p−1|` gives a comparable number.
- Box confidence is "derived from the answer distribution, not an independent visual check" [community]. No recommended threshold; tune on your own images. In our probe a correct dropdown box had confidence 0.31 while a correct button had 0.95, so **confidence is a weak gate for box; pair it with a presence noul and with deterministic checks** (the box must land on an element).

---

## 2. Live probe results [probed]

Screenshots of the GhostHand desktop settings page (1100×717) and a synthetic page with one button. All calls through SDK 0.7.0, header on, no retry.

| Case | Model | Input tokens | Latency | Result |
|---|---|---|---|---|
| Text-only state, noul + 4-way choice | 1.13.0 | 344 | 320 ms | baseline |
| Same questions, state `{screen: image 1100×717}` | 1.13.0 | 2,455 | 496 ms | noul 0.99, choice right (0.65) |
| Same | 1.14.0 | 2,455 | 277 ms | noul 0.99, choice **wrong** (`live` 0.71 vs true `setup`) |
| 4 box + 2 noul on the same screenshot | preview → `jev-1.14.0` | 2,501 | 275 ms | see below |
| Box on 1.13.0 | 1.13.0 | — | — | `400 api_usage_error "Invalid request."` |
| Element table (40 rows) + screenshot + goal, 41-way choice | 1.14.0 | 3,225 | 374 ms | `none` 0.41 (synthetic table; shape test only) |
| 640×417 PNG, 1 box | 1.14.0 | 1,006 | 315 ms | box right, 0.83 |
| 1280×834 PNG, 1 box | 1.14.0 | 3,079 | 262 ms | box right, 0.96 |
| 1280×834 JPEG q80, 1 box | 1.14.0 | 3,078 | 253 ms | box right, 0.94 (same tokens as PNG) |
| 1568×1022 PNG, 1 box | 1.14.0 | 4,460 | 474 ms | box right, 0.94 |
| 1600×1043 PNG | 1.14.0 | — | — | `400 "Invalid image dimensions."` |
| Two images (640×480 + 800×600), noul + box | 1.14.0 | 2,480 | — | noul 0.87, box right 0.84 |
| Image without the header | 1.14.0 | — | — | `400 "Images are experimental. Send the header …"` |

Box answers on the 1100×717 settings screenshot (true edges measured by hand):

| Target | True (t, b, l, r) | Jev | Confidence |
|---|---|---|---|
| "Save role models" button | 0.753, 0.790, 0.195, 0.290 | 0.75, 0.79, 0.19, 0.30 | 0.95 |
| "Models" sidebar entry | 0.125, 0.148, 0.062, 0.109 | 0.12, 0.18, 0.05, 0.15 | 0.67 |
| Writer role's Fallback dropdown | 0.323, 0.357, 0.632, 0.936 | 0.31, 0.37, 0.63, 0.95 | 0.31 |
| absent "Delete account" button | — | 0.43, 0.44, 0.19, 0.31 (thin sliver) | 0.08; paired noul 0.01 |

Observations:

- Centres of all three real targets fall inside the true element. Edges are within ~1–2% of the image size, with the largest error on the small sidebar entry (box 50% too tall). Good enough to click by centre; not good enough to assert exact bounds.
- Latency with one screenshot is the same 200–500 ms band as text. Image size barely moves it.
- JPEG q80 is 2.3× smaller than PNG at identical token cost and accuracy. Tokens depend on pixels, not bytes.
- Token cost fits `tokens ≈ 240 + (w × h) / 385` within ±5% over 280×280 … 1568×1022. At $0.042/M a 1280×800 step costs about $0.00013 for the image.
- 1.13 and 1.14 cost the same tokens for the same image.
- One 4-way choice went the other way between 1.13 and 1.14 on an easy question (which nav item is highlighted). Treat visual choice answers as **evidence to combine with the element table**, not as a replacement, and measure before switching the default model.

---

## 3. `@typesafe-ai/sdk@0.7.0` [src]

Breaking vs 0.6.0:

- `engines.node >= 22`. Fine: engine and CLI run Node 24; Electron 43.7.7 bundles Node 24.21.0 (zstd present).
- "Request payload types are no longer exported": `Question`, `Questions`, `EntryType`, `SystemOneRequest` **are** still exported; what went away is the internal wire payload. Our `toSdkQuestion` imports `Question`/`Questions` and compiles against 0.7.0 after adding the `box` case (`Question` is now a 4-way union, so the `switch` in `toSdkQuestion` must handle `box`, and `EntryType` now admits `Asset | TextWithAssets`).
- `usage.input_tokens`/`output_tokens` are `number | null`. Our `WireUsage` Zod schema must accept null.
- Invalid requests reject the returned `APIPromise` instead of throwing synchronously (our `try/await` already catches both).
- Compression: bodies ≥ 1 KiB are zstd-compressed (`Content-Encoding: zstd`) on Node ≥ 22.15 unless `compression: false`. Gateways may not accept it; carrier presets for OpenRouter/Vercel should set `compression: false` until verified. The SDK reads `node:zlib` via `process.getBuiltinModule`, so it still loads where Node modules are absent.
- Browser guard, retry policy, `timeout` per attempt, `.withResponse()`, error classes: unchanged.

New API:

```ts
import { TypeSafeClient, image, Image, withAssets, box, noul, choice, score } from "@typesafe-ai/sdk";

const client = new TypeSafeClient({ apiKey, defaultModel: "jev-1.14.0",
  defaultHeaders: { "TypeSafe-Danger-Zone-Images": "true" } });   // or per call: options.headers

const screen = image(pngBytes);           // Uint8Array | ArrayBuffer | Blob; PNG/JPEG sniffed from magic bytes
// String(screen) === "<image:<32 hex>>", the reference JSON.stringify writes wherever the object appears

const { data, requestId } = await client.systemOne({
  state: { goal, screen, elements },                       // image placed directly in state
  questions: {
    target: choice("… `screen` …", criteria),
    where:  box("The Save button in `screen`"),
  },
  model: "jev-1.14.0",
}, { signal, headers: { "TypeSafe-Danger-Zone-Images": "true" } }).withResponse();
data.answers.where.box.top; data.answers.where.confidence;  // number | null
```

- `image(data)` throws `TypeSafeError` on empty or non-binary data. It does **not** check dimensions, pixel count or byte size; the API does. We must pre-check (`preflight`) to avoid a paid 400/413.
- Three ways to reference an image: place the `Image` object directly in content; interpolate it with the `withAssets` tagged template (an untagged template rejects before sending); or pass `assets: {"<name>": img}` and write `<name>` in plain strings. Every `assets` name must appear in the request.
- Requests with images are always sent as `multipart/form-data`: part `request` holds the JSON, each image is a part named by the asset entry; bytes are copied at call time, so the caller may reuse buffers. The multipart body is still zstd-compressed when ≥ 1 KiB.
- `box(instructions?)` builder; `BoxResponse {type:"box", box:{top,bottom,left,right}, confidence: number|null}`.
- `RequestOptions.headers` merges over `defaultHeaders`; the SDK's own headers win.

---

## 4. What this means for GhostHand

1. **Grounding without a VLM round-trip.** `box` on `jev-1.14.0` locates a described target on a screenshot in ~300 ms for ~$0.0001. That is 10–50× cheaper and faster than the current `VisionGrounder` LLM call and should become the first rung of mode D (vision assist) and the fallback when the element table has no usable target (canvas, custom widgets, poor a11y, desktop hosts with weak AX bounds).
2. **The screenshot as evidence in the normal step.** Adding `screen` to the state costs ~3k tokens per step (a 1280×800 screenshot) against today's few hundred to tens of thousands for the element table. It fits the 32k per-question rule as long as the element table is kept under ~25k tokens. Whether it improves the `target` choice is an empirical question (the probe saw one regression on 1.14) and must be measured on the testbed before it becomes the default.
3. **Model pinning.** Keep `jev-1.13.0` for text-only steps until the eval suite says otherwise. Use `jev-1.14.0` (pinned, not `jev-preview`) for any request with a `box` question. Plan for `jev-latest` moving to 1.14 and for 1.13 deprecation (60 days' notice).
4. **Screenshots must be prepared:** downscale so the longest side ≤ 1568 px, pad or upscale so each side ≥ 280 px and pixels ≥ 78,400, strip animation, prefer JPEG q80 over PNG for bandwidth (same tokens). Keep the scale factor to map box fractions back to CSS pixels or screen coordinates. Secrets: a screenshot can show typed secrets; the existing redaction rules for `[input:NAME]` fields must mask those regions or skip the image on steps that touch a secret.
5. **Danger-zone headers are opt-in by design.** Send `TypeSafe-Danger-Zone-Images` only on requests that carry images; never send `Long-Context` (it is slower and less accurate; our request fitting already keeps requests under 32k).
6. **Validation stays fail-closed.** A box is valid only if `0 ≤ top < bottom ≤ 1`, `0 ≤ left < right ≤ 1`; it is "grounded" only if its centre hits a known element's bounds or, when no element table exists, if a presence noul agrees. Confidence alone is not a gate.

## Unverified items

- The exact `jev-latest` switch date and the published deprecation policy.
- Whether OpenRouter, Vercel or Pydantic gateways forward images, the danger-zone header or `box` (LiteLLM does; the others are undocumented). Assume images are direct-API only.
- Box accuracy on dense desktop UIs, dark themes, DPI-scaled screens and small (< 24 px) targets. Only four targets were measured.
- Whether `confidence` can actually be `null` on the direct API (never seen in 20 box answers).
- Minimum side between 256 and 280 px (docs say 280; the probe tested 280 and up).
