// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { formatMoney, ORDER_STATUS_LABELS } from "@ghosthand/testbed-kit/orders";
import type { Order } from "./api.ts";

/** "Bob Ng · 2026-02-14 · $369.50 · Paid". */
export function formatOrderSummary(order: Order): string {
  return [
    order.customerName,
    order.placedOn,
    formatMoney(order.amountCents),
    ORDER_STATUS_LABELS[order.status],
  ].join(" · ");
}
