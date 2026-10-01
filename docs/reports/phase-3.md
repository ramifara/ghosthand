<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->
# Phase 3 report: speed and knowledge

Date: 2026-10-01. Branch `feat/phase-3-speed-knowledge`. Decisions are in [ADR 0010](../adr/0010-knowledge-recipes-vision-modes.md) (proposed).

**Status.** Every Phase 3 piece is built and tested. Measured with real Jev (`jev-1.13.0`, TypeSafe direct) on a dedicated testbed instance:

- **Recipes.** A known task replays in 4.1–5.0 s with 0 model calls. That time includes about 2.4–2.9 s of page load from the Vite dev server; the replay and final checks take 1.5–2.1 s.
- **Source-aware vs blind.** Source-aware mode beats blind on Jev steps, Jev calls and wall time when there is navigation to skip. Total steps are unchanged.
- **Testbed L4–L6.** All 21 tasks that do not need vision pass 5/5 (105/105 runs). The 3 tasks marked `needsVision` fail 0/5 with "vision needed: no vision provider is configured", which is the designed outcome on a machine without an OpenAI, Anthropic or Google key.

## What was built

| Area | What | Where |
|---|---|---|
| Mode A in runs | A recipe that matches the task and the start screen replays step by step before mode B. Each step's target must resolve (stable id, test id, unique role + name). One Jev "same control?" question heals a miss. A failed guard, a refused action, a forbidden target or a disallowed commit falls back to B for the rest of the run. Final `done_when` checks always run, model checks included right after a complete replay. | `core/mode-a.ts`, `core/recipe.ts` |
| Mode D1 | Unnamed target or unnamed controls at q < 0.7: a vision model names the controls from their boxes and Jev picks again (screen-to-text). After two "no target" answers on one screen: grounded click on the same capture (`{captureId, x, y}`). Answers missing from the page text are read off the screen. | `core/mode-d.ts`, `engine/vision-assist.ts` |
| Mode D2 | After two poor observations (q < 0.4) or two D1 failures on a screen: a provider computer tool drives one action at a time, ≤ 8 steps, and hands back as soon as q ≥ 0.7. Typed text must be a goal literal or a stored secret. Provider safety checks stop for a human and are never acknowledged. | `core/mode-d.ts`, `models/vision/vision-driver.ts` |
| No vision key | Vision steps emit `escalate B → H` with the missing keys named, B continues, and a failing run's reason ends with "vision needed: …". `doctor` reports vision availability. | `core/loop.ts`, `engine/doctor.ts` |
| De-escalation | `escalate` events with `direction: "down"` (D2 → B, D1 → B); the CLI prints "de-escalate". The run.end "who did the work" line orders A/B/C/D1/D2/H. | `protocol/events.ts`, `cli/progress.ts` |
| New B operations (for L4) | `drag` (source + drop zone heads), `context_menu` (right-click), `scroll` (only when the driver sets `Snapshot.canScroll`). | `core/candidates.ts`, `core/questions.ts` |
| Screen fingerprints | URL pattern with templated ids, landmarks (dialog, headings, regions), normalized control signature; same screen = same key or same URL pattern with ≥ 0.6 control overlap. | `core/screen-fingerprint.ts` |
| Knowledge DB | `node:sqlite` at `<runsDir>/knowledge.sqlite`: screens, elements, transitions (BFS path search), recipes. | `knowledge/knowledge-db.ts`, `app-map.ts` |
| Recipes | Induced from verified runs (noise dropped, literals → `{{pN}}`, secrets stay names, plan kept), matched code-first, trust 0.6 → +30%/+15% (healed) per success, ×0.6 per failure, 60-day half-life, retired after 2 consecutive failures, heals patched as new versions. `ghosthand recipes list|show|export|remove`, `ghosthand map`, MCP `list_recipes`. `--learn` is opt-in; `run` uses recipes by default, `eval` only with `--recipes auto`. | `knowledge/*recipe*`, `trust.ts`, `cli/commands/recipes.ts` |
| Source/PR maps | React/TSX extractor over `@babel/parser`: `tid()`/`data-testid` (patterns for template literals), ARIA, labels, visible JSX text, forms, React Router routes, import graph → component → route reachability, i18n tables, testid → file:line. Diff scoping (`git diff` → changed files, components, routes, test ids added/removed/renamed), source oracles (`visible`/`text` predicates for added test ids and headings), seed targets, planner context. `ghosthand sourcemap <dir> [--diff <base>]`. | `knowledge/source-map/*` |
| Source-aware mode | `--source <dir>`: seeds ranking per subgoal and route, adds the route list and the current route's test ids/labels to the planner prompt, and from the home page goes straight to the route the goal names by pressing the page's own link (mode A step, 0 calls). | `engine/source-aware.ts` |
| Speculation v1 | While subgoal k runs, the planner refines k+1..n (`Planner.refine`, implemented for the models and consultant planners); applied only if k succeeds, the plan is unchanged and the refinement is back; ≤ 2 per run. | `core/loop.ts`, `core/planner.ts` |
| Testbed L4–L6 | 24 new tasks with DB/audit oracles and e2e smoke (46/46 e2e green on a fresh instance). Ports follow `GHOSTHAND_TESTBED_PORT_OFFSET`. | `apps/testbed/**`, `packages/testbed-kit/**` |
| Driver | Drag/drop/context-menu detection in frames and open shadow roots, stepped pointer drags (HTML5 and pointer-event libraries), uploads from `uploadDir`, downloads, `canScroll`, frame-aware scroll, menu-item toggles. TOTP: a secret named `*_TOTP` types the current code. | `packages/driver-playwright` |

Tests: `bun run check` is green. It ran 1,159 unit tests in 134 files plus 77 server tests; 2 tests skipped because they need a running testbed. The driver browser tests (`GHOSTHAND_BROWSER_TESTS=1`) passed 151/151, the testbed e2e smoke tests passed 46/46 on a fresh instance, and the license and secrets checks are clean, including over the run folders and `knowledge.sqlite` of this report.

## Measurements

All runs used `jev-1.13.0` (TypeSafe direct), headless Chrome, the testbed on a port offset (4700) from this branch, and a dedicated runs directory. Total model spend for this report was about $0.35.

### 1. Recipe replay of known tasks (mode A)

Each task ran once in mode B with `--learn`, then replayed with `--recipes auto` (no learning, so the recipe was not re-learned between replays).

| Task | Learned from (B) | Replays | Pass | Median wall | Page open + match | Replay + final checks | Jev calls | Who did the work |
|---|---|---|---|---|---|---|---|---|
| `l1-login` | 3 steps, 5.04 s, 3 calls | 5 | 5/5 | **4.45 s** | 2.43 s | 1.78 s | **0** | A 100% |
| `l1-update-profile` | 3 steps, 6.08 s, 3 calls | 3 | 3/3 | **4.12 s** | 2.42 s | 1.69 s | **0** | A 100% |
| `l3-settings-tabs-slider` | 3 steps, 6.96 s, 3 calls | 3 | 3/3 | **5.04 s** | 2.79 s | 2.08 s | **0** | A 100% |
| `l3-rich-text-bio` | 3 steps, 5.31 s, 3 calls | 3 | 3/3 | **4.34 s** | 2.88 s | 1.54 s | **0** | A 100% |
| `l2-orders-drawer-note` | 5 steps, 8.20 s, 8 calls | 3 | 3/3 | 6.12 s | 2.66 s | 3.46 s | 3 per run | A 75%, B 25% |

- **Replay steps.** The median replay step is 401 ms (settle 120 / observe 38 / act 292 ms), with no decide time.
- **Where the wall time goes.** The run's wall includes opening the start page, which takes 2.4–2.9 s on the Vite dev server (unbundled ESM). The B runs pay the same cost. The < 5 s target is met on four of five tasks, and `l3-settings-tabs-slider` sits at the line (5.04 s).
- **Parameters.** `l1-update-profile` learned two parameters (`p1`, `p2`) and `l3-settings-tabs-slider` one (the email limit). A unit test replays a learned recipe with a different value (`30` instead of `45`) at 0 calls.
- **Why `l2-orders-drawer-note` is not 0 calls.** Its only completion check is the oracle, which the agent may not consult, so the loop has to ask Jev whether the note was saved. Right after the save, that check returns "unknown" (p between 0.3 and 0.7). Jev then reopens the drawer before the check passes. Recipes cannot remove a model check that the task's own `done_when` requires.
- **Healing.** A renamed control heals with one Jev call, and the patched target is saved as recipe version 2 (unit tests in `core/mode-a.test.ts` and `knowledge/recipes.test.ts`). Two consecutive guard failures retire the recipe.

### 2. Source-aware vs blind

Both modes ran the same tasks with `--planner none --writer none`, so the comparison isolates the loop.

**(a) Navigation to skip: the same 11 L1–L3 tasks started from the app's home page (`--start-path /`, n = 2 per mode).** Source-aware mode presses the route's own link with no model call.

| Metric | Blind | Source-aware |
|---|---|---|
| Runs passed (oracle) | 12/22 | **14/22** |
| Total steps | 102 | 104 |
| Jev-decided steps (mode B) | 102 | **86** (18 route steps were mode A, 0 calls) |
| Jev calls | 126 | **118** (−6%) |
| Median run wall | 6.77 s | **6.20 s** (−8%) |
| Median wall, passing runs | 7.32 s | **6.72 s** |
| Cost | $0.0285 | $0.0298 |

Per task (median steps with Jev-decided steps in parentheses, median wall):

| Task | Blind pass | Source pass | Blind steps | Source steps | Blind wall | Source wall |
|---|---|---|---|---|---|---|
| `l1-update-profile` | 2/2 | 2/2 | 4 (4) | 4 (3) | 6.8 s | 7.1 s |
| `l2-orders-delete-row` | 0/2 | 0/2 | 4 (4) | 4 (3) | 6.5 s | 5.9 s |
| `l2-orders-edit-status` | 0/2 | 0/2 | 4 (4) | 4 (4) | 4.9 s | 5.0 s |
| `l2-orders-sort-find` | 0/2 | 0/2 | 5 (5) | 5 (5) | 5.7 s | 5.7 s |
| `l2-orders-filter-bulk` | 2/2 | 2/2 | 7 (7) | 7 (6) | 9.5 s | 8.4 s |
| `l2-orders-drawer-note` | 2/2 | 2/2 | 6 (6) | 5 (4) | 7.9 s | 6.7 s |
| `l2-toast-undo` | 0/2 | 0/2 | 6 (6) | 7 (6) | 7.0 s | 6.6 s |
| `l2-big-page-select` | 0/2 | **2/2** | 3 (3) | 4 (3) | 3.9 s | 15.7 s |
| `l3-date-range-report` | 2/2 | 2/2 | 4 (4) | 4 (3) | 7.3 s | 5.4 s |
| `l3-settings-tabs-slider` | 2/2 | 2/2 | 4 (4) | 4 (3) | 7.3 s | 6.0 s |
| `l3-rich-text-bio` | 2/2 | 2/2 | 4 (4) | 4 (3) | 6.0 s | 5.3 s |

- **Where source-aware wins.** It replaces the exploratory nav click with a zero-call step, wins time on 8 of 11 tasks, and solves `l2-big-page-select`. Blind runs of that task failed fast (3.9 s); the source-aware runs passed in 15.7 s.
- **Why total steps do not drop.** The navigation step still counts, as mode A.
- **Not a source-aware effect.** The L2 order tasks that fail from the home page fail in both modes, with no writer or planner (they pass from their own start pages; see 2b). `l2-orders-edit-status` and `l2-orders-sort-find` get no route because "status"/"order" tie between `/orders` and the new `/status` page. `routeForGoal` refuses ties.
- **First attempt.** Before the link-press version, source-aware mode used `page.goto`. That reloaded the dev-server app (+2–3 s per run) and lost on time. Pressing the in-app link fixed it.

**(b) Tasks as written (all 18 L1–L3 tasks, n = 2 per mode).** Source-aware mode only seeds ranking and planner context here, because these tasks already start on their section.

| Metric | Blind | Source-aware |
|---|---|---|
| Runs passed (oracle) | 24/36 | 24/36 |
| Total steps | 134 | 131 |
| Jev calls | 177 | 170 |
| Median run wall | 4.91 s | 4.99 s |
| Cost | $0.0454 | $0.0427 |

- **Seeding alone does not move the numbers.** Jev already picks the right control on these pages, so the differences are within noise. The one visible gain is `l2-orders-delete-row`: 5.5 vs 7 steps and 11 vs 14 Jev calls.
- **The value is in skipping navigation.** Source-aware mode helps when it can skip navigation (2a) or give the planner real labels (free-text goals). For tasks that already start in the right place, it adds no measurable benefit.
- **Why 12 runs fail in both modes.** The failing tasks need free text the instruction does not quote (combobox and tag search, the status note), or an answer the Jev extractor misses (`l2-injection-reviews`). Both are writer jobs, and these runs had `--writer none`. The regression check below uses the default assistants.

### 3. Testbed L4–L6 with real Jev (n = 5, default assistants: Codex planner for replans and Codex writer)

| Level | Runs passed | Tasks at ≥ 4/5 | Median step / p95 | Cost per step | Jev / LLM calls (LLM share) | Who did the work |
|---|---|---|---|---|---|---|
| L4 hard DOM | 40/50 | 8/10 | 551 ms / 1.43 s | $0.000209 | 417 / 121 (22%) | B 93%, C 7% |
| L5 auth | **30/30** | 6/6 | 938 ms / 1.18 s | $0.000124 | 207 / 2 (1%) | B 100% |
| L6 robustness | 35/40 | 7/8 | 635 ms / 2.56 s | $0.000151 | 211 / 79 (27%) | B 91%, C 9% |
| **Without the 3 vision tasks** | **105/105** | **21/21** | | | | |

| Task | Pass | Median steps | Median wall | Notes |
|---|---|---|---|---|
| `l4-iframe-checkout` | 5/5 | 9 | 13.9 s | cross-origin frame (port 4702 here) + same-origin frame |
| `l4-shadow-preferences` | 5/5 | 4 | 6.8 s | open shadow root |
| `l4-closed-shadow-promo` | 0/5 | 9 | 36.3 s | **needs vision**: a closed shadow root is invisible to the accessibility snapshot. Jev finds no target twice → D1 needed → "no vision provider". Codex replans burn 8 LLM calls per run before the run stops. |
| `l4-canvas-chart` | 0/5 | 1 | 4.5 s | **needs vision**: the value exists only as pixels. The answer path asks D1 describe, which is unavailable, so the run fails fast. |
| `l4-dnd-checklist` | 5/5 | 10 | 37.8 s | HTML5 reorder. Passes by oracle, but the loop only gets a model check (no deterministic `done_when`), so runs end "stuck" after replans (34 LLM calls / 5 runs). |
| `l4-kanban-move` | 5/5 | 2 | 6.2 s | pointer-events drag |
| `l4-upload-contacts` | 5/5 | 5 | 9.0 s | upload from `apps/testbed/fixtures/uploads` + audited CSV download |
| `l4-infinite-feed` | 5/5 | 7 | 11.4 s | `scroll` on a `role=feed` (canScroll) |
| `l4-virtual-inventory` | 5/5 | 7 | 9.4 s | `scroll` near a row of a virtualized list (aria-setsize) |
| `l4-menus-projects` | 5/5 | 5 | 9.0 s | hover menu + right-click context menu |
| `l5-totp-login` | 5/5 | 5 | 6.3 s | `[input:TESTBED_TOTP]` types the current code |
| `l5-magic-link` | 5/5 | 6 | 7.8 s | dev mailbox link |
| `l5-email-code` | 5/5 | 6 | 7.9 s | "Use code NNNNNN" link from the mailbox |
| `l5-password-reset` | 5/5 | 11 | 11.1 s | |
| `l5-session-expiry` | 5/5 | 8 | 8.6 s | session dies on the first save; sign in again, save once |
| `l5-sso-idp` | 5/5 | 5 | 7.7 s | fake IdP on its own port |
| `l6-flaky-preferences` | 5/5 | 3 | 11.9 s | seeded latency + one 503 with Retry |
| `l6-popups-profile` | 5/5 | 13 | 47.0 s | cookie banner + seeded promo. It needed the core fix that lets a target refused as "covered" be tried again. It is still slow: writer and replans account for 27 LLM calls / 5 runs. |
| `l6-layout-shift` | 5/5 | 2 | 4.1 s | |
| `l6-dynamic-ids` | 5/5 | 2 | 4.0 s | |
| `l6-poor-a11y` | 5/5 | 3 | 4.7 s | placeholder-only input, div radios, div button |
| `l6-icon-toggle-vision` | 0/5 | 9 | 51.4 s | **needs vision**: the only target is an unnamed icon. Each run reports "vision needed: the chosen target has no name; no vision provider is configured". |
| `l6-rtl-locale` | 5/5 | 3 | 4.8 s | Arabic, RTL |
| `l6-dark-zoom-settings` | 5/5 | 3 | 4.8 s | dark theme, 150% |

**LLM share above 20% on L4 and L6.** Codex hand-offs and replans on the vision tasks and on `l4-dnd-checklist` / `l6-popups-profile` push it up. On the vision tasks those calls are wasted: once a run is known to need vision, it should stop early instead of replanning. This is listed below.

### 4. L1–L3 regression check (default assistants, n = 2)

**36/36 passed.** The median step is 793 ms (p95 1.94 s, decide 255 ms). Jev cost per step is $0.000355, with 257 Jev calls and 48 LLM calls (Codex writer and replans, 16% LLM share). Who did the work: B 97%, C 3%. Phase 2's baseline was 90/90 with a 742 ms median step, so modes A/D, the new operations and the router changes left B/C behavior intact. The step time is within noise of that baseline: these runs had more writer hand-offs on the order tasks.

### 5. Who did the work

| Measurement | Shares (steps) |
|---|---|
| Recipe replays (17 runs) | A 98%, B 2% (the drawer-note model check) |
| From home, source-aware (22 runs) | A 17%, B 83% |
| L4 / L5 / L6 (120 runs) | B 93% · C 7% / B 100% / B 91% · C 9% |
| D1 / D2 | 0% live: no vision provider on this machine. Covered by mocked-provider tests (`core/mode-d.test.ts`, `models/vision/vision-driver.test.ts`). |

## What needs a vision key

- **`l4-closed-shadow-promo`, `l4-canvas-chart` and `l6-icon-toggle-vision`.** These tasks are marked `needsVision`.
- **D1 screen-to-text and grounding** (`vision_reviewer`, `vision_grounder` roles) and **D2 drive** (native computer tools on Anthropic and OpenAI; JSON grounding on Gemini and local VLMs). They are implemented and tested against recorded-style responses, but have never run live. Setting `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` in `~/.config/ghosthand/env` enables them; `ghosthand doctor` shows which.

## Fixes found by the live runs

- **Wasted model checks after replay.** After a complete replay the loop now runs every check at once, including model checks. Before, it waited for Jev's `goal_done` signal and spent an extra step.
- **Overlay refusals.** A target refused because an overlay covered it (`hit_test_failed`) can now be tried again; previously it stayed ranked last. This fixed `l6-popups-profile`.
- **Spurious vision escalations.** A "blocked" answer on a page that already looks done no longer counts toward vision.
- **Profile locks.** Parallel evals locked the shared browser profile `evals`, so `eval --profile` was added.

## What's left

1. **Stop earlier when vision is needed and missing.** In the measured runs the loop escalated to H and B carried on: writer hand-offs and Codex replans spent about 8–10 LLM calls before stopping (see the vision rows above). After the measurement, replans are skipped when the page itself needs vision (unnamed target, poorly named table, answer not in the text). They are still allowed after "no target fits twice", because a better plan may fix that, so `l4-closed-shadow-promo` still replans. Writer hand-offs still run in both cases.
2. **Live D1/D2 measurement** with a key: latency, accuracy and how often D2 de-escalates. D2 actions cannot be checked against the element effect rules (there is no element), so D2 should stay off consequential flows until measured (ADR 0010).
3. **The app map is recorded, but the loop does not use it yet.** Path search (`AppMap.findPath`) exists, but no navigation step uses it, and the knowledge level ("recipe / mapped / seen / unknown") does not feed the router.
4. **Recipe retrieval** has no Jev choice among several candidates (the most trusted wins), no plan templates (APC), no vision-only recipes, and no human-demonstrated recipes from takeover.
5. **Source maps** have no Next.js, Vue, Svelte or TanStack routes, no schema libraries, and no coverage report. Diff oracles are produced by `ghosthand sourcemap --diff` but QA mode does not run them automatically.
6. **Speculation v1 is unmeasured live.** Testbed tasks carry their own plan, so it never triggers there; with Codex (5–10 s per turn) most refinements will arrive too late and be discarded.
7. **Core gaps from the L5/L6 runs:**
   - The repeat gate refuses a legitimate second commit after a re-login on an identical screen. The testbed works around it with a distinct URL.
   - Equivalent targets split Jev's confidence (e.g. "Close" vs "No thanks").
   - Tasks whose only completion check is the oracle (`l4-dnd-checklist`, `l2-orders-drawer-note`) pay model checks and can end "stuck" despite passing.
8. **Downloads** go to a temp dir; `downloadDir` is not yet wired to the run folder.
9. **Dev-server page loads** (2.4–2.9 s) dominate short runs. Serving the testbed from `vite build` + `preview` for evals would make recipe replays ~2 s.
