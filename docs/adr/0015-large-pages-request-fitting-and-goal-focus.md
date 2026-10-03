<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0015. Large pages: request fitting, goal focus, and new text

- Status: proposed
- Date: 2026-10-03

## Context

A run on a Google results page ("search for fat bear and feed that bear that shows up on the screen") ended with `the Jev call failed (too_large: 400 {"detail":{"error_type":"max_tokens_exceeded"}})`, repeated until the stall detector stopped it. Measured causes:

1. Token estimates assumed 3 characters per token. Our JSON states and questions run at about 2 (a Bing results page: 30.0k characters, 14.7k input tokens), so a request that passed our preflight was over Jev's 32k "state + longest question" limit.
2. Each question head carried up to 200 candidates and the act state was trimmed only by its own estimate, never together with the questions. A `too_large` answer was treated as an ordinary refusal and the same request was sent again.
3. On a large page the element the goal needs can be cut before Jev sees it: the driver keeps 200 elements by region rank (an overlay widget in region "other" loses to hundreds of result links), each head keeps its top candidates in the same order, and page text was clipped to its first 8,000 (driver) and 2,400 (state) characters, so a confirmation at the bottom of the page was never visible.

## Decision

- Estimate 2 characters per token in the Jev preflight and in the core. Every act request is built to fit the provider's limits with a 15 % margin (`request-fit.ts`): each round offers fewer candidates per head (200 × 0.6ⁿ, at least 12) and drops page context the heads do not need. A `too_large` answer is followed by up to two smaller re-asks in the same step, and the smaller budget stays for the rest of the run. The verify state is fitted too, keeping dialogs, headings, text and status first.
- Goal words (`focus-terms.ts`: content words of the goal and instruction) travel to `observe` (`ObserveScope.focus`). The web and desktop drivers keep dialog elements first, then elements naming more goal words, then the existing rank; a control on screen ranks like main content wherever it sits. In the core, goal words decide which candidates survive a per-head cap, but the survivors are offered in the usual order: Jev weighs earlier options more, and a goal-ordered list pulled it towards rows that merely mention the goal (measured on `l2-toast-undo`: 0/3 with goal-ordered offers, 5/5 with the usual order).
- Long page text keeps its start, the lines naming the most goal words, and (in the driver) its end. The state gains `new_text`: lines that appeared since the previous observation, when few enough lines changed that it is the same page (a closed dialog or a new page lists nothing, because a whole page of "new" text lowered Jev's confidence).

## Consequences

On a 156 kB results-like page with the target button after 1,000 other controls, "feed the bear" now succeeds in one action; on `main` the button never reached Jev. Requests on large pages are smaller and cheaper; on small pages nothing changes (the offered lists are identical when nothing is cut). L1–L3 with the same Jev and no vision stays within run-to-run noise (repeated runs of the tasks that differed: branch 4/6 and 5/5, `main` 1/6 and 3/3). Google itself could not be reproduced from this server (it answers with a CAPTCHA), so the Google case is covered by the unit test of a 400-link page and by the calibration above.
