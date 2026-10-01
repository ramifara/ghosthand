// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Fixed shop data for L2/L3. Customers are the same for every seed. The anchors below are pinned
// orders the tasks refer to; every other order comes from the seeded PRNG. Browser-safe.
import type { OrderStatus, OrderTag } from "./orders.ts";

/** Customers in id order (ids start at 1). Several share a first name so the combobox has to filter. */
export const CUSTOMER_NAMES = [
  "Bob Ng",
  "Hana Sato",
  "Dana Petrov",
  "Farah Rossi",
  "Kemi Ueda",
  "Lior Weber",
  "Mira Varga",
  "Mira Vance",
  "Mirabel Quinn",
  "Jonas Tan",
  "Chidi Okafor",
  "Goran Xu",
  "Eun-ji Young",
  "Ivo Zim",
  "Nils Weber",
] as const;
export type CustomerName = (typeof CUSTOMER_NAMES)[number];

export function customerEmail(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@shop.example`;
}

export const ORDER_COUNT = 50;
export const FIRST_ORDER_NUMBER = 1001;
/** Generated orders fall on FIRST_ORDER_DATE plus 0..ORDER_DATE_SPAN-1 days (through 2026-02-28). */
export const FIRST_ORDER_DATE = "2026-01-05";
export const ORDER_DATE_SPAN = 55;
/** Exactly this many generated orders start out pending, so the filtered list fits on one page. */
export const PENDING_ORDER_COUNT = 7;

export interface OrderAnchor {
  id: string;
  customer: CustomerName;
  placedOn: string;
  status: Exclude<OrderStatus, "pending">;
  tags: readonly OrderTag[];
  note: string;
}

function anchor(
  id: string,
  customer: CustomerName,
  placedOn: string,
  status: OrderAnchor["status"],
  tags: readonly OrderTag[] = [],
): OrderAnchor {
  return { id, customer, placedOn, status, tags, note: "" };
}

/**
 * Orders pinned for every seed. No generated order shares a (customer, date) pair with an anchor,
 * so "Bob Ng's order from 2026-02-14" always means exactly one row.
 */
export const ORDER_ANCHORS = {
  /** l2-orders-delete-row target. */
  deleteTarget: anchor("ord_1007", "Bob Ng", "2026-02-14", "paid"),
  /** Same customer, another day. */
  deleteSameCustomer: anchor("ord_1019", "Bob Ng", "2026-02-03", "shipped"),
  /** Same day, another customer. */
  deleteSameDate: anchor("ord_1028", "Hana Sato", "2026-02-14", "paid"),
  /** l2-orders-edit-status target. */
  editStatus: anchor("ord_1012", "Farah Rossi", "2026-01-21", "paid"),
  /** l2-orders-drawer-note target. */
  drawerNote: anchor("ord_1003", "Kemi Ueda", "2026-01-09", "shipped"),
  /** l2-toast-undo target. */
  toastUndo: anchor("ord_1042", "Lior Weber", "2026-01-20", "paid"),
  /** l3-assign-customer-combobox target. */
  combobox: anchor("ord_1033", "Jonas Tan", "2026-02-06", "paid"),
  /** l3-tags-multiselect target. */
  tags: anchor("ord_1016", "Chidi Okafor", "2026-01-30", "paid", ["gift"]),
} as const satisfies Record<string, OrderAnchor>;
