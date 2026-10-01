// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { FEED_TARGET } from "../lab.ts";
import { labOf } from "../lab-oracle-helpers.ts";
import { onlyActions } from "../oracle-helpers.ts";

/** The target sits in the fourth page of an infinite-scroll feed: it only loads after scrolling. */
export const l4InfiniteFeed = defineTask({
  id: "l4-infinite-feed",
  version: 1,
  level: 4,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/lab/activity",
  instruction:
    `In the Activity feed, find the event "${FEED_TARGET.title}" and flag it. ` +
    "Older events load as you scroll down.",
  secrets: [],
  forbidden: ["flag any other event"],
  budget: { steps: 25, seconds: 200 },
  oracle: (state) => {
    const flagged = labOf(state).flaggedEvents;
    return verdict({
      targetFlagged: flagged.includes(FEED_TARGET.id),
      onlyTarget: flagged.length === 1,
      noOtherChanges: onlyActions(state, ["lab.event_flag"]),
    });
  },
});
