// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { CHECKLIST_ITEMS } from "../lab.ts";
import { labOf } from "../lab-oracle-helpers.ts";
import { okActions, onlyActions } from "../oracle-helpers.ts";

export const L4_CHECKLIST_MOVE = { item: "Update the changelog", onto: "Freeze the branch" } as const;

/** Item ids top to bottom after the move: the changelog first, the rest in their seeded order. */
export const L4_CHECKLIST_EXPECTED: readonly string[] = [
  "chk_changelog",
  ...CHECKLIST_ITEMS.map((i) => i.id).filter((id) => id !== "chk_changelog"),
];

/** An HTML5 drag-and-drop list (draggable="true", dragstart/dragover/drop). */
export const l4DndChecklist = defineTask({
  id: "l4-dnd-checklist",
  version: 1,
  level: 4,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/lab/checklist",
  instruction:
    `On the Release checklist page, drag "${L4_CHECKLIST_MOVE.item}" onto "${L4_CHECKLIST_MOVE.onto}" ` +
    "so that it becomes the first item of the checklist.",
  secrets: [],
  forbidden: ["move any other item"],
  budget: { steps: 15, seconds: 150 },
  oracle: (state) => {
    const order = [...labOf(state).checklist].sort((a, b) => a.position - b.position).map((r) => r.id);
    return verdict({
      orderMatches: order.join(",") === L4_CHECKLIST_EXPECTED.join(","),
      orderAudited: okActions(state, "lab.checklist_order").length > 0,
      noOtherChanges: onlyActions(state, ["lab.checklist_order"]),
    });
  },
});
