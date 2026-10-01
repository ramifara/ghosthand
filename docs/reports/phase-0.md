<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->
# Phase 0 report (P0-13)

Date: 2026-10-01. Status: **done. Phase 0 acceptance met with real Jev (L1 20/20, median step 910 ms).**

## What was built

| Task | Result | PR |
|---|---|---|
| P0-01 bootstrap, license | AGPL-3.0-only, CLA note, trademarks, notices, SPDX headers on every file (CI-checked), AGENTS.md, ADRs 0001–0004 | initial commit |
| P0-02 monorepo | Bun workspaces (hoisted), TypeScript 7 project references, Biome, Vitest, changesets, CI (check, license, secrets, e2e) | #1 |
| P0-03 protocol | Zod schemas for every cross-process shape, `Result`, `Computer`/`DecisionProvider`/`AgentConsultant` | #2 |
| P0-04 Jev provider | `@typesafe-ai/sdk` 0.6.0 pinned, preflight limits, fail-closed validation, cost meter + cap, error mapping, probe script | #6 |
| P0-05 Codex consultant | app-server JSON-RPC client + exec fallback, read-only, approvals declined, probe | #7 |
| P0-06 testbed L0–L1 | Hono/Bun + SQLite, control API on :4401, 4 L1 tasks with DB oracles, Playwright e2e | #8 |
| P0-07 browsers, profiles | Chrome/Edge/Brave detection, persistent profiles, Chrome profile import (refuses live profiles) | #5 |
| P0-08/09 web Computer | aria snapshot → redacted element table, aria-ref actions with freshness, settle, effect read-back, origin guard, TOTP/credential tools, redacted traces | #13 |
| P0-10 recorder | run folders, redacted `events.jsonl` (re-validated after redaction), SQLite index, replay reader | #3 |
| P0-11 core loop | mode B loop, question builders, gates, stall detection, budgets, done_when | #4 |
| P0-12 engine + CLI | config/env, pino, OTel spans, run/replay lifecycle, `run`/`replay`/`runs`/`doctor`/`profile`/`tasks`/`observe` | #14 |

Phase 1 work that also landed: P1-02 models (#10), P1-03 planner (#11, #18), P1-04 writer (#18), P1-05 verify path (#9), P1-07 testbed L2–L3 (#12), P1-08 evals (#16), P1-10 speculation (#17), P1-11 replay v1 (#15).

## Measurements

### Step timing on the live testbed (no Jev)

`ghosthand eval --suite l1 --n 2 --decision heuristic --headless`. The heuristic provider is a rule-based stand-in that answers in ~0 ms, so these numbers isolate everything except the decision call.

| Metric | Value |
|---|---|
| Runs passed (oracle) | 6/8 (`l1-form-validation` needs real reasoning) |
| Median step / p95 | 511 ms / 856 ms |
| Median split: settle / observe / decide / act / verify | 7 / 119 / 2 / 382 / 0 ms |
| Replay of each passing run | oracle pass, 0 decision calls, ~3.7–3.8 s wall |

- **observe** (~120 ms) includes the per-step PNG screenshot; `observe()` alone is 15–70 ms.
- **act** (~380 ms) is dominated by the 250 ms "no DOM mutation" window plus effect read-back.
- With Jev at the documented ~180–250 ms, the expected median mode-B step is **~0.75–0.9 s**, inside the Phase 0 target (≤ 1 s). Phase 1's ≤ 0.8 s needs the act/observe savings below.

### Codex consultant (P0-05)

Median planning turn 5.3 s (app-server, gpt-5.6-sol) to 7.9 s (gpt-6.1-sol); 9/9 schema-valid. Planner probe (P1-03): 6/6 valid plans, 7–11 s each. See `docs/research/codex-probe.md`, `docs/research/planner-probe.md`.

### Acceptance run with real Jev (P0-12)

`ghosthand eval --suite l1 --n 5 --headless --planner none`, `jev-1.13.0` direct, git `a5677a9`.

| Task | Pass | Median steps | Median wall | Mean cost |
|---|---|---|---|---|
| `l1-login@1` | 5/5 | 3 | 5.01 s | $0.000295 |
| `l1-login-wrong-password@1` | 5/5 | 3 | 5.10 s | $0.000365 |
| `l1-update-profile@1` | 5/5 | 3 | 4.91 s | $0.000332 |
| `l1-form-validation@1` | 5/5 | 4 | 6.42 s | $0.000451 |

| Metric | Value | Phase 0 target |
|---|---|---|
| Runs passed (oracle) | **20/20** | L1 task 4/5 |
| Median step / p95 | **910 ms** / 1.26 s | ≤ 1 s |
| Split: settle / observe / decide / act / verify | 7 / 126 / 243 / 454 / 1 ms | |
| Cost per step | **$0.000111** | (P1: < $0.001) |
| Jev calls / LLM calls | 70 / 0 (LLM share 0%) | ≤ 1 consultant call |
| Who did the work | B 100% | |

Replay of recorded runs re-executes with 0 decision calls (verified on the live testbed for l1-login, l1-update-profile, l1-login-wrong-password).

### Jev probe (P0-04)

Details in `docs/research/jev-probe.md`. p50 225 ms / p95 313 ms over 30 calls; limits as documented (255 options, 10 levels, null levels rejected, 32k state+question rule enforced, over-context = 400 `max_tokens_exceeded`); 10/10 identical choices on repeats (max drift 0.03); 46 calls cost $0.0028. Two code changes followed: over-context maps to `too_large`, and the score-mean tolerance scales with levels because the API rounds probabilities.

## Wrong or low-confidence decisions

None in the acceptance run: every action passed its gates first time (70 Jev calls for 65 steps; the extra calls are the answer step and option questions). Two bugs were found by the plumbing runs and fixed:

1. Secret text options were keyed `secret_<NAME>`; key-based redaction then turned their probabilities into `"[redacted]"`, which broke the event schema. Keys are now opaque (`sec_N`) and the recorder re-validates every event after redaction.
2. Testbed `done_when` included the oracle predicate, which would have let the agent see ground truth. The engine strips oracle predicates from the loop; the oracle only grades the run afterwards.

## Bun friction (keep or switch)

**Keep Bun.** Friction seen: lockfile conflicts on every parallel PR (resolved by regenerating `bun.lock`), `changeset init` waiting on a prompt, and the testbed's Bun server exiting when files changed under it. No Playwright or Electron runtime issues, because those run on Node.

## Proposed Phase 1 changes

1. Cut act latency: shorten the DOM-quiet window for value-only actions (fill/select) where read-back already confirms the value; keep 250 ms after presses.
2. Write screenshots off the hot path (fire-and-forget) and skip them on replay unless asked.
3. Enable browser tests in CI (`GHOSTHAND_BROWSER_TESTS=1`; GitHub runners have Chrome).
4. Default role bindings (ADR 0005, proposed) to be set from P1-12 measurements.

## Open questions for review

- OpenAI key: needed to measure the models planner/writer (Codex covers planning today).
- ADR 0005 (models layer) is marked proposed; it records refusal/abort/budget stopping the fallback chain, `store: false`, and per-role minimum context.
