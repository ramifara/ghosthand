<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0017. Guidance levels, writer shortlists, choice-scaled confidence, and backtracking

- Status: proposed
- Date: 2026-10-03

## Context

After ADR 0016 the mechanics are fast enough (a Wikipedia step ~5 s, Jev 0.4 s of it), but open-ended navigation still fails: on a page with hundreds of equally plausible links Jev spreads probability thin (`Economy 0.25, South Dakota 0.19, none 0.4`) and has no way to know which link leads toward a goal several pages away. That is knowledge, and the writer (a larger model) is the component that has it; today it is only asked after a refused step, and only for a one-line hint. Rami's priorities for this phase: reaching the goal matters more than the number of steps or the wall clock; a larger model may be consulted as often as every step with a quick model; confidence demands should follow the number of choices; a wrong guess should be backtracked rather than refused.

## Decision

- **Guidance level** (`guidance`: `off | stuck | unsure | every`, default `unsure`; a setting in the desktop app, `--guidance` in the CLI). `stuck` is the previous behaviour (writer hint after a refused step). `unsure` adds a writer shortlist when Jev's answer is not decisive. `every` asks the writer before each decision when the page offers six or more candidates.
- **Shortlist.** `Writer.shortlist` (optional; implemented for the models layer and the Codex/Claude consultants) sees the goal, the page text, the ranked candidate lines (`id — role "name" · context`, at most 150), the recent history and the dead ends on this page, and returns up to five ids, optional text to type and a note. The act questions then offer only those candidates; Jev still decides, with `none` falling back to the full table once. The writer narrows; it never clicks.
- **Choice-scaled confidence.** An `advance` action (undone with Back) runs when its target is the most likely element, beats `none` and `ambiguous`, and has at least `max(advanceTarget, advanceChoiceFactor / options)` probability (defaults 0.2 and 1.5: 75 % of two options, 50 % of three, 20 % beyond seven). Commits keep the fixed 0.7.
- **Backtracking.** Advance navigations are recorded per subgoal (from which URL, by which link). When a page holds nothing for the goal (Jev `blocked`/`none` after the shortlist and the hint also failed), the loop goes back to the URL the last advance started from, ranks that link last there, and continues; at most three times per subgoal.

- **Shortlist semantics.** Jev confirms or vetoes a shortlist rather than re-ranking it: "ambiguous" (three plausible links fit "equally well" by construction), a thin spread or a pick outside the list resolves to the writer's first pick; only `none` at 0.5 or more is a veto. A shortlisted `advance` passes the target gate. An empty shortlist with a note ("the round has ended", "still loading") makes the step wait for the page instead of refusing; the stall detector ends a page that never changes.
- **Completion decided by the writer.** Evidence of completion is often on a page that has already moved on (a win screen, a "saved" toast), where Jev's page-based noul answers "unsatisfied". When a subgoal has only model predicates and the writer reports the goal reached on two consecutive steps with nothing left to pick, the subgoal ends satisfied with `decidedBy: "writer"`; deterministic checks and oracles are never overridden. With guidance `every` the loop does not speculate (a speculative plain ask skipped the shortlist). A control that is not ready in time (a click timeout while the page loads its next state) and a page that moved under an action (stale token, retried once by stable id) are waits, not dead ends.
- **Budget defaults.** `DEFAULT_BUDGET` and the desktop default move from 25 steps / 180 s / $0.25 to 60 steps / 600 s / $0.50: a guided step costs 5–10 s and an open-ended goal can take 40 of them.

## Consequences

With `every`, each step costs one writer call (2–8 s on Codex, about a second on a quick API model); with `unsure`, only steps where Jev hesitates do. Per-step cost rises and the LLM share may exceed the plan's 20 % target on navigation-heavy goals; the plan's gate thresholds are kept for commits. Shortlists make Jev's answers decisive by construction (few options), so the choice-scaled rule mostly matters without a writer. Backtracking depends on the previous page still being reachable by URL. The unit tests cover the three guidance levels, the scaled gate and a backtrack with a scripted writer and decider.
