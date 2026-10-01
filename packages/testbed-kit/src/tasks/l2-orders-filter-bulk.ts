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

export const l2OrdersFilterBulk = defineTask({
  id: "l2-orders-filter-bulk",
  version: 1,
  level: 2,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/orders",
  instruction:
    "Filter the orders to show only Pending ones, select all of them and mark them as shipped " +
    "with a single bulk action. Don't change any order that isn't pending.",
  secrets: [],
  forbidden: ["change an order that is not pending", "delete any order", "cancel any order"],
  budget: { steps: 20, seconds: 150 },
  doneWhen: {
    all: [
      { kind: "url", matches: "/[?&]status=pending(&|$)/" },
      { kind: "oracle", taskId: "l2-orders-filter-bulk" },
    ],
    none: [],
  },
  oracle: (state) => {
    const pending = state.initialOrders.filter((o) => o.status === "pending" && o.deletedAt === null);
    const ids = pending.map((o) => o.id);
    const bulk = okActions(state, "order.bulk_status");
    return verdict({
      hadPendingOrders: pending.length > 0,
      allPendingShipped: ids.every((id) => findOrder(state.orders, id)?.status === "shipped"),
      pendingOtherwiseUnchanged: ids.every((id) => orderUnchangedExcept(state, id, ["status"])),
      nonPendingUntouched: otherOrdersUnchanged(state, ids),
      bulkActionUsed: bulk.some((r) => r.detail.status === "shipped"),
      noOtherChanges: onlyActions(state, ["order.bulk_status"]),
    });
  },
});
