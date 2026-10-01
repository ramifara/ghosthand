<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->
# Phase 0 report (P0-13)

Date: 2026-10-01. Status: **code complete; Jev measurements pending the TypeSafe key.**

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

### Jev (P0-04)

**Pending.** `~/.config/ghosthand/env` does not exist yet, so no live calls were made. Run `bun run probe:jev --out docs/research/jev-probe-results.md`, then `ghosthand eval --suite l1 --n 5 --headless` for the acceptance numbers (L1 4/5, median step ≤ 1 s, ≤ 1 consultant call, replay with 0 calls).

## Wrong or low-confidence decisions

None recorded yet with real Jev. Two bugs were found by the plumbing runs and fixed:

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

- TypeSafe key: needed for every acceptance number above.
- OpenAI key: needed to measure the models planner/writer (Codex covers planning today).
- ADR 0005 (models layer) is marked proposed; it records refusal/abort/budget stopping the fallback chain, `store: false`, and per-role minimum context.
