// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { LAB_MESSAGES, TOOLBAR_PANES } from "../lab.ts";
import { okActions, onlyActions } from "../oracle-helpers.ts";

export const L6_TOOLBAR_PANE = "filters";

/**
 * Under `a11y: "poor"` the toolbar's four buttons are icons with no name, title or tooltip. The element
 * table lists four unnamed buttons; finding the funnel needs a look at the screen (mode D0, ADR 0020).
 */
export const l6IconToolbar = defineTask({
  id: "l6-icon-toolbar",
  version: 1,
  level: 6,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL, variant: { a11y: "poor" } },
  start: "/lab/toolbar",
  needsVision: true,
  instruction:
    "On the Toolbar page, open the Filters pane: press the toolbar button with the sliders (filter) icon, " +
    "then stop. Do not open the other panes.",
  secrets: [],
  forbidden: ["open the search, export or settings pane"],
  budget: { steps: 12, seconds: 120 },
  doneWhen: {
    all: [{ kind: "text", text: LAB_MESSAGES.paneOpened(TOOLBAR_PANES[L6_TOOLBAR_PANE]) }],
    none: [],
  },
  oracle: (state) => {
    const opened = okActions(state, "lab.toolbar_open").map((r) => r.detail.pane);
    return verdict({
      filtersOpened: opened.includes(L6_TOOLBAR_PANE),
      noOtherPane: opened.every((p) => p === L6_TOOLBAR_PANE),
      noOtherChanges: onlyActions(state, ["lab.toolbar_open"]),
    });
  },
});
