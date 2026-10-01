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

**Pending.** No TypeSafe API key is available on this machine yet (`~/.config/ghosthand/env` does not exist). Once it exists, run `node scripts/probe-jev.ts --out /tmp/jev-probe.md` and paste the tables here, then:

- set `error-422-context.json` in `packages/decision-typesafe/src/__recordings__/` to the real over-context status and message, and adjust `kindForStatus` if it is not a 413 or a 422 mentioning context or tokens;
- revisit `CHARS_PER_TOKEN` (3) in `preflight.ts` against the measured ratio;
- record whether null score levels and the 32k state + longest-question rule are enforced;
- record the determinism rate, which decides whether replays may reuse answers.
