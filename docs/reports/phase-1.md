<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->
# Phase 1 report (P1-12)

Date: 2026-10-01. Status: **done. Every Phase 1 acceptance criterion is met with real Jev.**

## Acceptance

`ghosthand eval --suite l1-l3 --n 5 --headless` (planner and writer on auto: Codex login, no OpenAI key), `jev-1.13.0` direct, git `0275b99`.

| Criterion (plan §8) | Result | Target |
|---|---|---|
| L1–L3 tasks | **90/90 runs; every one of 18 tasks 5/5** | each ≥ 4/5 |
| Median mode-B step | **742 ms** (p95 1.96 s) | ≤ 0.8 s |
| LLM/consultant share | **18%** (631 Jev / 138 LLM calls) | ≤ 20% |
| Jev cost per step | **$0.000344** ($0.147 for 90 runs) | < $0.001 |
| Replay heals a moved element | one Jev `same_control` call (engine test: renamed "Sign in" → "Log in") | 1 call |
| Replay with 0 decision calls on an unchanged app | verified live (l1-login, l1-update-profile, l1-login-wrong-password) | 0 calls |
| Evals table | `packages/evals`, `ghosthand eval` | produced |

Step split (median): settle 9 ms · observe 47 ms · decide 257 ms · act 329 ms · verify 1 ms. Who did the work: B 96%, C 4%.

### Per task

| Task | Pass | Median steps | Median wall | Mean cost |
|---|---|---|---|---|
| `l1-login@1` | 5/5 | 3 | 4.56 s | $0.000346 |
| `l1-login-wrong-password@1` | 5/5 | 3 | 4.84 s | $0.000420 |
| `l1-update-profile@1` | 5/5 | 3 | 4.52 s | $0.000396 |
| `l1-form-validation@1` | 5/5 | 4 | 5.55 s | $0.000537 |
| `l2-orders-delete-row@1` | 5/5 | 4 | 13.76 s | $0.004004 |
| `l2-orders-edit-status@1` | 5/5 | 6 | 13.35 s | $0.002332 |
| `l2-orders-sort-find@1` | 5/5 | 4 | 14.27 s | $0.002745 |
| `l2-orders-filter-bulk@1` | 5/5 | 10 | 33.09 s | $0.003242 |
| `l2-orders-drawer-note@1` | 5/5 | 9 | 24.96 s | $0.003124 |
| `l2-toast-undo@1` | 5/5 | 7 | 15.05 s | $0.003626 |
| `l2-big-page-select@1` | 5/5 | 3 | 12.92 s | $0.001467 |
| `l2-injection-reviews@1` | 5/5 | 1 | 5.69 s | $0.000348 |
| `l3-assign-customer-combobox@1` | 5/5 | 7 | 19.38 s | $0.002526 |
| `l3-tags-multiselect@1` | 5/5 | 8 | 19.21 s | $0.002870 |
| `l3-date-range-report@1` | 5/5 | 3 | 4.79 s | $0.000472 |
| `l3-settings-tabs-slider@1` | 5/5 | 3 | 4.77 s | $0.000340 |
| `l3-rich-text-bio@1` | 5/5 | 3 | 4.32 s | $0.000356 |
| `l3-accordion-tooltip@1` | 5/5 | 3 | 4.78 s | $0.000322 |

(Mean cost includes Jev only; Codex hand-offs and replans use the user's ChatGPT plan and cost $0 in API terms.)

## How we got there

The first full L1–L3 run passed **30/90**. Each failure was traced from the run folder (events, gate refusals, Jev answers) and fixed in code; no prompt was tuned to a specific task:

| Finding | Fix |
|---|---|
| Six L2/L3 tasks "succeeded" in 0 steps | Stripping the oracle left only checks that were already true; absence-only checks were treated as "all satisfied" (vacuous truth). Now: absence alone is never done; a single-subgoal task needs one action first; weak remaining checks get a Jev goal check in the oracle's place. |
| Answer tasks never reported | Answer step: Jev picks the page passage that answers; the writer only composes when none fits; triggered as soon as nothing is left to do. |
| Dates split into numbers | Literals keep ISO dates, money and percentages whole. |
| Sliders invisible to the agent | Driver offers `set_value` on ARIA sliders (keyboard stepping to `aria-valuenow`). |
| "Make the word bold" impossible | New `select_text` operation with its own selection question. |
| Multi-select replaced the selection; listbox read-back always "confirmed" | Multi-selects add; listbox read-back uses `aria-selected`; combobox options are picked among visible ones. |
| "Save changes" refused as "change the status" | Forbidden-phrase check takes only a control's leading word as its verb. |
| Low target confidence with no writer | Codex-backed writer when no OpenAI key is set; eval wires planner and writer. |
| Conditional goal re-done after success | The Jev goal check replaces the oracle only when the remaining page checks are weak. |
| Step latency 910 ms | Short post-action settle for value-only actions (act 454 → 329 ms); screenshots captured in parallel with verify/decide (observe 126 → 47 ms). |

## Phase 5 acceptance (checked here because it needed real Jev)

`ghosthand test apps/testbed/specs/profile.md --runs 5 --variant bug=profile-title`: the planted bug is **caught 5/5** (decided by the deterministic check); without the bug the same spec passes 10/10 decisive steps (score 95.2/100). MCP `run_task` runs the engine end to end (in-memory client test and `bun run smoke:mcp`).

## Decisions

- **Default role bindings:** keep Codex as planner and writer when no API key is configured (measured above); models-layer bindings in ADR 0005 stay placeholders until an OpenAI key is measured.
- **Gates** unchanged from the plan (operation 0.65, target 0.7, stuck 0.85): with the writer available, low-confidence steps resolve through hand-offs instead of lower thresholds.
- **Bun:** keep.

## Open

- OpenAI/Anthropic/Google keys: needed to measure the models planner/writer, vision judge (QA visual score) and Phase 3's vision modes.
- p95 step 1.96 s comes from writer hand-offs (Codex turns of 4–10 s are excluded from step timing but slow tasks such as filter-bulk to ~33 s); a fast API writer would cut those.
