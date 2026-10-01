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

const target = ORDER_ANCHORS.editStatus;

export const l2OrdersEditStatus = defineTask({
  id: "l2-orders-edit-status",
  version: 1,
  level: 2,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/orders",
  instruction: `Order ${target.id} was refunded. Edit it and set its status to Cancelled. Change nothing else.`,
  secrets: [],
  forbidden: ["delete any order", "change the customer or tags", "edit any other order"],
  budget: { steps: 20, seconds: 150 },
  doneWhen: {
    all: [{ kind: "oracle", taskId: "l2-orders-edit-status" }],
    none: [{ kind: "visible", role: "dialog", name: `Edit order ${target.id}` }],
  },
  oracle: (state) => {
    const updates = okActions(state, "order.update");
    return verdict({
      statusCancelled: findOrder(state.orders, target.id)?.status === "cancelled",
      otherFieldsUnchanged: orderUnchangedExcept(state, target.id, ["status"]),
      othersIntact: otherOrdersUnchanged(state, [target.id]),
      updateAudited: updates.some((r) => r.detail.id === target.id),
      noOtherChanges: onlyActions(state, ["order.update"]) && updates.every((r) => r.detail.id === target.id),
    });
  },
});
