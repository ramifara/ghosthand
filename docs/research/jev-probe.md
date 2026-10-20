<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# Jev probe (direct TypeSafe API)

Task P0-04. Measures what the research notes (`notes/typesafe-direct.md`) could not check without a key: latency, the real limits, the over-context error, determinism and cost. Thresholds and preflight settings in `@ghosthand/decision-typesafe` should be revisited against these numbers.

## How to run

```sh
# key from the environment or ~/.config/ghosthand/env (a line TYPESAFE_API_KEY=..., chmod 600)
bun run probe:jev                                   # prints the Markdown report to stdout
node scripts/probe-jev.ts --out /tmp/jev-probe.md   # also writes it to a file
```

Flags: `--calls N` (latency sample, default 30), `--repeats N` (determinism sample, default 10), `--cap-usd X` (spend cap, default 0.10), `--base-url URL` (gateway or local mock). The script exits with a message if no key is found. It is never run in CI.

## Method

All calls go through `createTypeSafeDecisionProvider` with a shared `CostMeter`, so the probe uses the same code path as the agent and stops at the spend cap.

1. **Question types.** One request with a login-screen state and three questions: `goal_done` (noul), `target` (choice over five elements plus `none`), `risk` (score with three levels). Production settings: `jev-1.13.0`, 2.5 s per attempt, 1 retry, preflight on, fail-closed validation.
2. **Latency.** The same request 30 times in sequence. Reports p50, p95, min, max of the provider's `latencyMs` (includes any retry) and the error kinds seen.
3. **Token calibration.** A one-noul request with state `"x"` and one with 30,000 characters of deterministic filler text. The input-token difference gives characters per token, used to size the context cases and to check the preflight's chars/3 estimate.
4. **Limits.** Preflight disabled, no retry, 60 s timeout, so the API decides:
   - choice with 255 options (expect accept) and 256 (expect reject)
   - score with 10 levels (expect accept) and 11 (expect reject)
   - score with a `null` level (undocumented; the spec says no null)
   - ~30k-token state (expect accept), ~40k (over the documented 32k state + longest-question rule; expect reject), ~70k (over 64k; expect reject)
   For each case: outcome, HTTP status, our `DecisionError` kind, the error message, our token estimate and the billed input tokens.
5. **Determinism.** The step-1 request 10 times. Reports how many answer sets are byte-identical to the first, how many pick the same `target`, and the maximum absolute drift of any probability, noul `p` or score.
6. **Cost.** Total calls, input tokens and USD at $0.042 per million input tokens. A full run is about 50 calls and roughly 100k input tokens, so well under $0.01.

The script was dry-run against a local mock of `/v1/systemone` (127.0.0.1 only) to check the flow and the report format. No real API calls have been made yet.

## Results

### Run 2026-10-01T13:24:55.514Z

Model `jev-1.13.0`, direct API, Node v26.4.0. Spend cap $0.100000.

#### Question types (one request, production settings)

| question | type | answer |
|---|---|---|
| goal_done | noul | p=0.09 |
| target | choice | e3 (conf 0.95; e3=0.96, e1=0.02, none=0.01, e2=0.01, e5=0, e4=0) |
| risk | score | 0.94 (conf 0.87; 1=0.92, 0=0.07, 2=0.01) |

Request `req_01a0f7a3829974cebc60826d67bbebec`, 609 input tokens, 296 ms, $0.000026.

#### Latency (30 sequential calls, 3 questions, 2.5 s timeout, 1 retry)

| ok | errors | p50 ms | p95 ms | min ms | max ms | mean input tokens |
|---|---|---|---|---|---|---|
| 30 | 0 | 225 | 313 | 203 | 319 | 609 |

#### Limits (preflight disabled, no retry)

| case | expected | outcome | HTTP | est. tokens (chars/3) | input tokens | ms | detail |
|---|---|---|---|---|---|---|---|
| choice with 255 options | accept | accepted | 200 | 1659 | 4916 | 255 | o17 (conf 0.98; o17=0.99, o99=0.01, o207=0, o133=0, o104=0, o176=0, … 249 more) |
| choice with 256 options | reject | rejected: invalid | 400 | 1666 | - | 173 | 400 Too many choices. Must have at most 255 choices. |
| score with 10 levels | accept | accepted (1 abstained) | 200 | 67 | 370 | 214 | ABSTAIN: score 6.86 is not within 0.02 of the distribution mean 6.7600 |
| score with 11 levels | reject | rejected: invalid | 400 | 71 | - | 174 | 400 Too many score levels. Must have at most 10 levels. |
| score with a null level | unknown | rejected: invalid | 422 | 30 | - | 177 | 422 questions.level.score.criteria.1.str: Input should be a valid string; questions.level.score.criteria.1.dict[any,any]: Input should be a valid dictionary; qu |
| ~30k-token state | accept | accepted | 200 | 56045 | 30173 | 483 | p=0.62 |
| ~40k-token state (over the 32k state+question rule) | reject | rejected: invalid | 400 | 74719 | - | 251 | 400 {"detail":{"error_type":"max_tokens_exceeded"}} |
| ~70k-token state (over 64k) | reject | rejected: invalid | 400 | 130741 | - | 390 | 400 {"detail":{"error_type":"max_tokens_exceeded"}} |

Measured 5.60 characters per token on the filler text (the preflight assumes 3).

#### Determinism (10 identical requests)

| ok | errors | identical answers | fraction | same choice | max probability drift |
|---|---|---|---|---|---|
| 10 | 0 | 1 | 0.10 | 10/10 | 0.0300 |

#### Cost

| calls | input tokens | cost (USD) |
|---|---|---|
| 46 | 66333 | $0.002786 |

### What changed because of these numbers

- Over-context is a **400** with `{"detail":{"error_type":"max_tokens_exceeded"}}` (not 413/422). It now maps to `too_large` (`error-400-max-tokens.json` recording).
- The documented limits hold: 255 options / 10 levels; null score levels are rejected (422); the 32k "state + longest question" rule is enforced (~40k state rejected while under 64k total).
- Score answers come with rounded probabilities: a 10-level score of 6.86 had a recomputed mean of 6.76. The fail-closed check now allows `max(0.02, 0.015 × (levels − 1))`.
- Measured ~5.6 characters per token on English filler (the ~30k case: 56k estimated vs 30.2k billed). The preflight's chars/3 over-counts by ~1.9×, so it is conservative: the 20k-token state guard trips at roughly 10–11k real tokens of prose (JSON element tables tokenize less densely, so the real margin is smaller). Kept as is; revisit if narrowing triggers too often.
- Determinism: 10/10 identical choices, max probability drift 0.03; the fail-closed probability checks are unaffected.
- Latency p50 225 ms / p95 313 ms direct, matching the research notes' ~180–250 ms.

### Run 2026-10-17T17:21:50.800Z

Model `jev-1.13.0`, direct API, Node v26.4.0. Spend cap $0.100000.

#### Question types (one request, production settings)

| question | type | answer |
|---|---|---|
| goal_done | noul | p=0.09 |
| target | choice | e3 (conf 0.95; e3=0.96, e1=0.02, e2=0.01, none=0.01, e4=0, e5=0) |
| risk | score | 0.91 (conf 0.82; 1=0.88, 0=0.11, 2=0.01) |

Request `req_01a14ae2433f71958c39604194f9af08`, 609 input tokens, 654 ms, $0.000026.

#### Latency (5 sequential calls, 3 questions, 2.5 s timeout, 1 retry)

| ok | errors | p50 ms | p95 ms | min ms | max ms | mean input tokens |
|---|---|---|---|---|---|---|
| 5 | 0 | 254 | 308 | 214 | 308 | 609 |

#### Limits (preflight disabled, no retry)

| case | expected | outcome | HTTP | est. tokens (chars/3) | input tokens | ms | detail |
|---|---|---|---|---|---|---|---|
| choice with 255 options | accept | accepted | 200 | 2489 | 4916 | 263 | o17 (conf 0.99; o17=0.99, o99=0.01, o0=0, o1=0, o2=0, o3=0, … 249 more) |
| choice with 256 options | reject | rejected: invalid | 422 | 2499 | - | 206 | 422 questions.pick.choice.criteria: Dictionary should have at most 255 items after validation, not 256 |
| score with 10 levels | accept | accepted | 200 | 101 | 370 | 210 | 6.88 (conf 0.87; 7=0.9, 8=0.02, 0=0.01, 1=0.01, 2=0.01, 3=0.01, 4=0.01, 5=0.01, 6=0.01, 9=0.01) |
| score with 11 levels | reject | rejected: invalid | 422 | 107 | - | 184 | 422 questions.level.score.criteria: List should have at most 10 items after validation, not 11 |
| score with a null level | unknown | rejected: invalid | 422 | 45 | - | 183 | 422 questions.level.score.criteria.1.str: Input should be a valid string; questions.level.score.criteria.1.dict[any,any]: Input should be a valid dictionary; qu |
| ~30k-token state | accept | accepted | 200 | 84067 | 30173 | 554 | p=0.52 |
| ~40k-token state (over the 32k state+question rule) | reject | rejected: too_large | 400 | 112078 | - | 377 | 400 {"detail":{"error_type":"max_tokens_exceeded"}} |
| ~70k-token state (over 64k) | reject | rejected: too_large | 400 | 196112 | - | 217 | 400 {"detail":{"error_type":"max_tokens_exceeded"}} |

Measured 5.60 characters per token on the filler text (the preflight assumes 3).

#### Determinism (3 identical requests)

| ok | errors | identical answers | fraction | same choice | max probability drift |
|---|---|---|---|---|---|
| 3 | 0 | 1 | 0.33 | 3/3 | 0.0300 |

#### Images and box (Jev 1.14, ADR 0020)

Image `docs/reports/phase-2-screens/settings-models.png`: image/png, 1100×717, 101254 bytes; estimated 2289 image tokens per use.

| case | model / outcome | est. tokens | input tokens | ms | answers |
|---|---|---|---|---|---|
| noul + box on the vision model | jev-1.14.0 | 2523 | 2447 | 272 | present: p=0.99; where: box t=0.75 b=0.79 l=0.19 r=0.3 (conf 0.88) |
| absent target: noul + box | jev-1.14.0 | 2525 | 2447 | 280 | present: p=0.01; where: box t=0.76 b=0.79 l=0.2 r=0.3 (conf 0.73) |
| image-only noul (no box) | jev-1.14.0 | 2426 | 2408 | 333 | present: p=0.99 |
| box on jev-1.13.0 (expect image_rejected) | error: image_rejected | 2363 | - | 217 | 400 400 Invalid request. |

#### Cost

| calls | input tokens | cost (USD) |
|---|---|---|
| 17 | 54147 | $0.002274 |

