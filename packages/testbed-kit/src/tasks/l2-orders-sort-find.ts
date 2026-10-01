// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { answerMentionsOrder, onlyActions, otherOrdersUnchanged } from "../oracle-helpers.ts";
import { type OrderRow, OrdersQuery, queryOrders } from "../orders.ts";

/** Ground truth: the highest-amount order on page 2 of the list sorted by date, newest first. */
export function l2SortFindExpected(orders: readonly OrderRow[]): OrderRow | undefined {
  const page = queryOrders(orders, OrdersQuery.parse({ page: 2, sort: "placedOn", dir: "desc" }));
  return [...page.orders].sort((a, b) => b.amountCents - a.amountCents)[0];
}

export const l2OrdersSortFind = defineTask({
  id: "l2-orders-sort-find",
  version: 1,
  level: 2,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/orders",
  instruction:
    "On the Orders page, sort the orders by date placed with the newest first and go to page 2. " +
    "Report the order ID of the order with the highest amount on that page.",
  secrets: [],
  forbidden: ["edit, delete or bulk-update any order"],
  budget: { steps: 20, seconds: 150 },
  doneWhen: {
    all: [
      { kind: "url", matches: "/[?&]page=2(&|$)/" },
      { kind: "url", matches: "/[?&]sort=placedOn(&|$)/" },
      { kind: "url", matches: "/[?&]dir=desc(&|$)/" },
    ],
    none: [],
  },
  oracle: (state, ctx) => {
    const expected = l2SortFindExpected(state.initialOrders);
    return verdict({
      answerCorrect: expected !== undefined && answerMentionsOrder(ctx.answer, expected.id),
      ordersUnchanged: otherOrdersUnchanged(state),
      noChanges: onlyActions(state, []),
    });
  },
});
