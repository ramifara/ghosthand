// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L2/L3 orders: row shapes, the list query (shared by the server and oracles so both sort the same way),
// revenue totals and money formatting. Browser-safe.
import { z } from "zod";

export const ORDER_STATUSES = ["pending", "paid", "shipped", "cancelled"] as const;
export const OrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  paid: "Paid",
  shipped: "Shipped",
  cancelled: "Cancelled",
};

export const ORDER_TAGS = ["gift", "priority", "fragile", "wholesale", "returning", "international"] as const;
export const OrderTag = z.enum(ORDER_TAGS);
export type OrderTag = z.infer<typeof OrderTag>;

export const CustomerRow = z.object({ id: z.number().int(), name: z.string(), email: z.string() });
export type CustomerRow = z.infer<typeof CustomerRow>;

/** YYYY-MM-DD. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format.");

export const OrderRow = z.object({
  id: z.string(),
  customerId: z.number().int(),
  customerName: z.string(),
  placedOn: IsoDate,
  amountCents: z.number().int(),
  status: OrderStatus,
  note: z.string(),
  tags: z.array(OrderTag),
  /** Set when the order was deleted (soft delete, so Undo can restore it). */
  deletedAt: z.string().nullable(),
});
export type OrderRow = z.infer<typeof OrderRow>;

/** PATCH /api/orders/:id. Only the fields present change. */
export const OrderPatch = z.strictObject({
  customerId: z.number().int().positive().optional(),
  status: OrderStatus.optional(),
  tags: z.array(OrderTag).max(ORDER_TAGS.length).optional(),
});
export type OrderPatch = z.infer<typeof OrderPatch>;

export const BulkStatusInput = z.strictObject({
  ids: z.array(z.string()).min(1).max(100),
  status: OrderStatus,
});
export type BulkStatusInput = z.infer<typeof BulkStatusInput>;

export const ORDERS_PAGE_SIZE = 10;
export const NOTE_MAX = 200;
/** How long a toast stays on screen before it dismisses itself. */
export const TOAST_DURATION_MS = 8000;

export const OrderSortKey = z.enum(["id", "customer", "placedOn", "amount", "status"]);
export type OrderSortKey = z.infer<typeof OrderSortKey>;
export const SortDir = z.enum(["asc", "desc"]);
export type SortDir = z.infer<typeof SortDir>;

/** List parameters, as they appear in the page URL and the API query string. Invalid values fall back. */
export const OrdersQuery = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  sort: OrderSortKey.catch("id").default("id"),
  dir: SortDir.catch("asc").default("asc"),
  status: OrderStatus.optional().catch(undefined),
  q: z.string().trim().max(60).catch("").default(""),
});
export type OrdersQuery = z.infer<typeof OrdersQuery>;

export interface OrdersPage {
  orders: OrderRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

function compare(a: OrderRow, b: OrderRow, sort: OrderSortKey): number {
  switch (sort) {
    case "id":
      return a.id.localeCompare(b.id);
    case "customer":
      return a.customerName.localeCompare(b.customerName);
    case "placedOn":
      return a.placedOn.localeCompare(b.placedOn);
    case "amount":
      return a.amountCents - b.amountCents;
    case "status":
      return a.status.localeCompare(b.status);
  }
}

/** Filters, sorts and pages the live (not deleted) orders. Ties always break on id, ascending. */
export function queryOrders(all: readonly OrderRow[], query: OrdersQuery): OrdersPage {
  const q = query.q.toLowerCase();
  const rows = all
    .filter((o) => o.deletedAt === null)
    .filter((o) => query.status === undefined || o.status === query.status)
    .filter((o) => q === "" || o.id.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q))
    .sort((a, b) => {
      const primary = compare(a, b, query.sort);
      if (primary !== 0) return query.dir === "asc" ? primary : -primary;
      return a.id.localeCompare(b.id);
    });
  const pageCount = Math.max(1, Math.ceil(rows.length / ORDERS_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const start = (page - 1) * ORDERS_PAGE_SIZE;
  return {
    orders: rows.slice(start, start + ORDERS_PAGE_SIZE),
    total: rows.length,
    page,
    pageCount,
    pageSize: ORDERS_PAGE_SIZE,
  };
}

export interface RevenueTotals {
  from: string;
  to: string;
  count: number;
  totalCents: number;
}

/** Revenue between two dates, inclusive. Deleted and cancelled orders don't count. */
export function revenueBetween(all: readonly OrderRow[], from: string, to: string): RevenueTotals {
  const rows = all.filter(
    (o) => o.deletedAt === null && o.status !== "cancelled" && o.placedOn >= from && o.placedOn <= to,
  );
  return { from, to, count: rows.length, totalCents: rows.reduce((sum, o) => sum + o.amountCents, 0) };
}

/** "$1,234.56". Locale-independent so the page and the oracle agree. */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${(abs % 100).toString().padStart(2, "0")}`;
}

/** Every money amount mentioned in free text, in cents ("$1,234.56", "1234.56", "1,234"). */
export function moneyMentions(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)) {
    const whole = Number((m[1] ?? "").replace(/,/g, ""));
    const fraction = (m[2] ?? "").padEnd(2, "0");
    out.push(whole * 100 + Number(fraction || "0"));
  }
  return out;
}
