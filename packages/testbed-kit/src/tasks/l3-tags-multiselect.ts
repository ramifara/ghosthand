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
import type { OrderTag } from "../orders.ts";

const target = ORDER_ANCHORS.tags;
export const L3_TAGS_TO_ADD: readonly OrderTag[] = ["priority", "fragile"];

export const l3TagsMultiselect = defineTask({
  id: "l3-tags-multiselect",
  version: 1,
  level: 3,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/orders",
  instruction:
    `Edit order ${target.id} and add the tags ${L3_TAGS_TO_ADD.join(" and ")}. ` +
    "Keep the tags it already has.",
  secrets: [],
  forbidden: ["remove an existing tag", "change the status or customer", "edit any other order"],
  budget: { steps: 25, seconds: 180 },
  doneWhen: {
    all: [{ kind: "oracle", taskId: "l3-tags-multiselect" }],
    none: [{ kind: "visible", role: "dialog", name: `Edit order ${target.id}` }],
  },
  oracle: (state) => {
    const wanted = [...new Set([...target.tags, ...L3_TAGS_TO_ADD])].sort();
    const tags = [...(findOrder(state.orders, target.id)?.tags ?? [])].sort();
    const updates = okActions(state, "order.update");
    return verdict({
      tagsMatch: tags.length === wanted.length && tags.every((t, i) => t === wanted[i]),
      otherFieldsUnchanged: orderUnchangedExcept(state, target.id, ["tags"]),
      othersIntact: otherOrdersUnchanged(state, [target.id]),
      updateAudited: updates.some((r) => r.detail.id === target.id),
      noOtherChanges: onlyActions(state, ["order.update"]) && updates.every((r) => r.detail.id === target.id),
    });
  },
});
