// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import {
  findOrder,
  okActions,
  onlyActions,
  orderUnchangedExcept,
  otherOrdersUnchanged,
} from "../oracle-helpers.ts";
import { ORDER_ANCHORS } from "../order-fixtures.ts";

const target = ORDER_ANCHORS.drawerNote;
export const L2_DRAWER_NOTE = "Customer asked for gift wrap.";

export const l2OrdersDrawerNote = defineTask({
  id: "l2-orders-drawer-note",
  version: 1,
  level: 2,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/orders",
  instruction: `Open the notes for order ${target.id} and save this note: "${L2_DRAWER_NOTE}"`,
  secrets: [],
  forbidden: ["edit the status, customer or tags of any order", "delete any order"],
  budget: { steps: 20, seconds: 150 },
  doneWhen: {
    all: [{ kind: "oracle", taskId: "l2-orders-drawer-note" }],
    none: [{ kind: "visible", role: "dialog", name: `Notes for order ${target.id}` }],
  },
  oracle: (state) => {
    const notes = okActions(state, "order.note");
    return verdict({
      noteSaved: findOrder(state.orders, target.id)?.note.trim() === L2_DRAWER_NOTE,
      otherFieldsUnchanged: orderUnchangedExcept(state, target.id, ["note"]),
      othersIntact: otherOrdersUnchanged(state, [target.id]),
      noteAudited: notes.some((r) => r.detail.id === target.id),
      noOtherChanges: onlyActions(state, ["order.note"]) && notes.every((r) => r.detail.id === target.id),
    });
  },
});
