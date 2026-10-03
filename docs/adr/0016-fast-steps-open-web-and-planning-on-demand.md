<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0016. Fast steps, the open web, and planning on demand

- Status: proposed
- Date: 2026-10-03

## Context

Rami's benchmark runs ("play a round of wikipedia game", Wikipedia navigation) took 6–8 s per step, got stuck on pages with many equally good links, and never finished; the same rounds take Codex with a mouse and vision about 50 s. Measured on this branch's instrumentation (`GHOSTHAND_LOG_LEVEL=debug` prints per-phase action timings):

- Jev itself took 0.3–0.5 s per call. Of an 8 s step on Wikipedia, 3.3 s were two full aria snapshots (the region narrowing re-captured the page), 2–7 s were the settle waiting for a network that never goes quiet (analytics beacons, lazy images) and 4 s was one click, of which 2.1 s was the post-action settle at its cap and 1.1 s three sequential in-page probes.
- The narrowing question chose the "Economy" section every step because it matched the goal text, and the next link ("Agriculture") was not in it; Jev honestly answered "none" and the run was refused three times.
- A start URL that redirects to another origin (thewikigame.com → play.hey.gg) was blocked: ad-hoc goals only allowed the start origin, so the agent spent a minute on a Chrome error page.
- The Codex planner took 15–25 s per call and was called five times in one run (91 of 171 s): once before the first click, and at every replan with a speculative refinement thrown away. Planner subgoals came with 2–3 steps, so one refused step forced a replan.
- The writer failed every call on the ChatGPT plan ("No object generated"), so hand-offs never helped; a link press to another origin was a `commit` needing approval; a link wrapped over two lines failed the hit test at its box centre and was retried five times; a replan's last subgoal with a check that already held ("heading visible") ended a run as a success without any action.

## Decision

- **Settle**: once the document is past `loading`, has no loading indicator and has been still for the DOM quiet window, pending network requests stop blocking after `networkToleranceMs` (1.2 s). The post-action settle cap drops from 2 s to 1.2 s; the step settle before the next observe covers the rest. The two probe pairs around an action run in parallel.
- **Observe**: a scoped observe (region narrowing, or `reuseCapture` for the whole-page re-ask) is served from the last full capture when nothing acted since, with tokens re-stamped to the new snapshot id. Observe never inherits an action timeout under 5 s.
- **Narrowing**: a region Jev was scoped to and found nothing in is marked dead for that screen and not offered again; the step is decided again on the whole page (fitted to the model's limits) at once instead of being refused.
- **Open web**: without an explicit allowlist (a goal on any site) the agent may navigate anywhere the blocklist does not forbid; the start origin is seeded only into an explicit allowlist. A link to another origin is then an `advance`, not a `commit` (name rules such as "Pay" still apply).
- **Gates**: an `advance` action runs when its target has ≥ `gates.advanceTarget` (0.45) and at least twice the runner-up element's probability, because many good links spread a calibrated answer thin; commits keep the 0.7 rule.
- **Planning**: planners mark themselves `slow` (CLI consultants). A slow planner is not called before the first action and does no speculative refinement; it plans on demand at the first escalation. Speculative refinement starts after a subgoal's first confirmed action. Planner subgoals get at least `MIN_SUBGOAL_STEPS` (5). When a replan's last subgoal is satisfied before any action in it, Jev confirms the task's own goal with one noul before the run ends.
- **Writer**: a structured answer with prose or a fence around the JSON is salvaged (`json-salvage.ts`); a provider that cannot follow the schema gets one plain-text ask in a one-line form.
- **Hit test**: the centre of each line box of the target is tested (a wrapped link's bounding-box centre lies on the paragraph); a covered target is scrolled to the viewport centre and retested once; a target that stays covered twice counts as tried.

## Consequences

Wikipedia steps went from ~8 s to ~5 s (observe 1.7 s, click ~2.7 s, Jev 0.4 s) and no longer trap Jev in a region. The Wikipedia game now loads and is played (Dastar → Sewa → Hinduism → … → Mumbai, seven links in about a minute, with Codex hints at 4–8 s each) instead of failing on the start page; a round is still not won within the game's own timer, and the remaining gap to a vision agent is choosing the route, which is model knowledge (the writer's hint), not mechanics. A page that keeps mutating its DOM still pays the settle cap; a slow planner means a free-text goal starts without a plan, which is the Jev-first design. Opening the web for ad-hoc goals is what "Goal on any site" means; testbed tasks and `--allow-origin` keep their allowlists.
