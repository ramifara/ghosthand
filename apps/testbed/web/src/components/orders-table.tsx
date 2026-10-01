// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The orders data table. Real table semantics: caption, column headers with aria-sort, the order ID
// as the row header. Row action buttons are deliberately identical ("Edit", "Notes", "Delete"):
// only the row they sit in tells them apart.
import {
  formatMoney,
  ORDER_STATUS_LABELS,
  type OrderSortKey,
  type SortDir,
} from "@ghosthand/testbed-kit/orders";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { Order } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { tid } from "../lib/tid.ts";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/select.tsx";

export const SORT_LABELS: Record<OrderSortKey, string> = {
  id: "Order",
  customer: "Customer",
  placedOn: "Placed on",
  amount: "Amount",
  status: "Status",
};

const SORTABLE: OrderSortKey[] = ["id", "customer", "placedOn", "amount", "status"];

const STATUS_TONE = {
  pending: "bg-accent-soft text-foreground",
  paid: "bg-good-soft text-good",
  shipped: "bg-code text-foreground",
  cancelled: "bg-bad-soft text-bad",
} as const;

export interface OrdersTableProps {
  rows: readonly Order[];
  loading: boolean;
  caption: string;
  sort: OrderSortKey;
  dir: SortDir;
  onSort(key: OrderSortKey): void;
  selected: ReadonlySet<string>;
  onSelect(next: ReadonlySet<string>): void;
  onAction(kind: "edit" | "notes" | "delete", order: Order): void;
}

export function OrdersTable({
  rows,
  loading,
  caption,
  sort,
  dir,
  onSort,
  selected,
  onSelect,
  onAction,
}: OrdersTableProps) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelect(next);
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm" aria-busy={loading} {...tid("orders.table")}>
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-background text-left text-xs text-muted">
          <tr>
            <th scope="col" className="w-8 px-2 py-2">
              <Checkbox
                aria-label="Select all orders on this page"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                disabled={rows.length === 0}
                onChange={() => onSelect(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                {...tid("orders.select-all")}
              />
            </th>
            {SORTABLE.map((key) => {
              const active = sort === key;
              const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th
                  key={key}
                  scope="col"
                  aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn("px-2 py-1 font-medium", key === "amount" ? "text-right" : undefined)}
                >
                  <button
                    type="button"
                    onClick={() => onSort(key)}
                    className="inline-flex items-center gap-1 rounded px-1 py-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
                    {...tid(`orders.sort.${key}`)}
                  >
                    {SORT_LABELS[key]}
                    <Icon aria-hidden="true" className={cn("size-3", active ? "text-accent" : undefined)} />
                  </button>
                </th>
              );
            })}
            <th scope="col" className="px-2 py-2 font-medium">
              Tags
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-2 py-6 text-center text-muted">
                {loading ? "Loading orders…" : "No orders match these filters."}
              </td>
            </tr>
          ) : (
            rows.map((o) => (
              <tr
                key={o.id}
                className={cn("border-t border-border", selected.has(o.id) ? "bg-accent-soft" : undefined)}
                {...tid(`orders.row.${o.id}`)}
              >
                <td className="px-2 py-1.5">
                  <Checkbox
                    aria-label={`Select order ${o.id}`}
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                    {...tid("orders.row.select")}
                  />
                </td>
                <th scope="row" className="px-3 py-1.5 text-left font-mono font-normal">
                  {o.id}
                </th>
                <td className="px-3 py-1.5">{o.customerName}</td>
                <td className="px-3 py-1.5 font-mono whitespace-nowrap">{o.placedOn}</td>
                <td className="px-3 py-1.5 text-right font-mono whitespace-nowrap">
                  {formatMoney(o.amountCents)}
                </td>
                <td className="px-3 py-1.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs", STATUS_TONE[o.status])}>
                    {ORDER_STATUS_LABELS[o.status]}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-xs text-muted">{o.tags.join(", ")}</td>
                <td className="px-2 py-1.5">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAction("edit", o)}
                      {...tid("orders.row.edit")}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAction("notes", o)}
                      {...tid("orders.row.notes")}
                    >
                      Notes
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onAction("delete", o)}
                      {...tid("orders.row.delete")}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
