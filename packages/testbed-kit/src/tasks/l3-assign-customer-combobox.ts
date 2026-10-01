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

const target = ORDER_ANCHORS.combobox;
/** Typing "Mira" also offers Mira Vance and Mirabel Quinn. */
export const L3_COMBOBOX_CUSTOMER = "Mira Varga";

export const l3AssignCustomerCombobox = defineTask({
  id: "l3-assign-customer-combobox",
  version: 1,
  level: 3,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/orders",
  instruction: `Order ${target.id} was placed for the wrong customer. Edit it and assign it to ${L3_COMBOBOX_CUSTOMER}.`,
  secrets: [],
  forbidden: ["change the status or tags of any order", "edit any other order", "delete any order"],
  budget: { steps: 25, seconds: 180 },
  doneWhen: {
    all: [{ kind: "oracle", taskId: "l3-assign-customer-combobox" }],
    none: [{ kind: "visible", role: "dialog", name: `Edit order ${target.id}` }],
  },
  oracle: (state) => {
    const wanted = state.customers.find((c) => c.name === L3_COMBOBOX_CUSTOMER);
    const updates = okActions(state, "order.update");
    return verdict({
      customerAssigned: wanted !== undefined && findOrder(state.orders, target.id)?.customerId === wanted.id,
      otherFieldsUnchanged: orderUnchangedExcept(state, target.id, ["customerId"]),
      othersIntact: otherOrdersUnchanged(state, [target.id]),
      updateAudited: updates.some((r) => r.detail.id === target.id),
      noOtherChanges: onlyActions(state, ["order.update"]) && updates.every((r) => r.detail.id === target.id),
    });
  },
});
