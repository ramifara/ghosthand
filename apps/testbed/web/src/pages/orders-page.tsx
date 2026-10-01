// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L2: the orders table. Server-side pagination, sorting and filtering (state lives in the URL),
// identical per-row Edit/Notes/Delete buttons, a modal edit form, a notes drawer, a confirm dialog
// before delete, toasts with Undo, and bulk select with a bulk status action.
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  type OrderSortKey,
  OrderStatus,
  OrdersQuery,
} from "@ghosthand/testbed-kit/orders";
import { Search } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { OrderDeleteDialog } from "../components/order-delete-dialog.tsx";
import { OrderEditDialog } from "../components/order-edit-dialog.tsx";
import { OrderNotesDrawer } from "../components/order-notes-drawer.tsx";
import { OrdersTable, SORT_LABELS } from "../components/orders-table.tsx";
import { RequireSession } from "../components/require-session.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { NativeSelect } from "../components/ui/select.tsx";
import { api, type Order, type OrdersPage as OrdersPageData } from "../lib/api.ts";
import { tid } from "../lib/tid.ts";
import { useToast } from "../lib/toast-context.tsx";

export function OrdersPage() {
  return <RequireSession what="see orders">{() => <OrdersView />}</RequireSession>;
}

type Dialog = { kind: "edit" | "notes" | "delete"; order: Order } | null;

function OrdersView() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const query = useMemo(() => OrdersQuery.parse(Object.fromEntries(new URLSearchParams(search))), [search]);
  const [data, setData] = useState<OrdersPageData | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [searchText, setSearchText] = useState(query.q);
  const [bulkPending, setBulkPending] = useState(false);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let stale = false;
    void api.orders(query).then((res) => {
      if (stale) return;
      if (res.ok) {
        setData(res.value);
        setError(undefined);
      } else {
        setError(res.message);
      }
    });
    return () => {
      stale = true;
    };
  }, [query, reloadKey]);

  // A new page, sort or filter starts with nothing selected.
  useEffect(() => setSelected(new Set()), [search]);

  function update(next: Partial<OrdersQuery>) {
    const merged = { ...query, ...next };
    const out = new URLSearchParams({ page: String(merged.page), sort: merged.sort, dir: merged.dir });
    if (merged.status) out.set("status", merged.status);
    if (merged.q) out.set("q", merged.q);
    setParams(out);
  }

  function sortBy(key: OrderSortKey) {
    const dir = query.sort === key && query.dir === "asc" ? "desc" : "asc";
    update({ sort: key, dir, page: 1 });
  }

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    update({ q: searchText.trim(), page: 1 });
  }

  async function bulk(status: OrderStatus) {
    const ids = [...selected];
    setBulkPending(true);
    const res = await api.bulkStatus(ids, status);
    setBulkPending(false);
    if (!res.ok) {
      toast({ message: res.message });
      return;
    }
    toast({ message: res.value.message });
    setSelected(new Set());
    reload();
  }

  function onDeleted(order: Order, message: string) {
    setDialog(null);
    reload();
    toast({
      message,
      action: {
        label: "Undo",
        onClick: () => {
          void api.restoreOrder(order.id).then((res) => {
            toast({ message: res.ok ? res.value.message : res.message });
            reload();
          });
        },
      },
    });
  }

  function onSaved(_order: Order, message: string) {
    setDialog(null);
    reload();
    toast({ message });
  }

  const filtered = query.status !== undefined || query.q !== "";
  const rows = data?.orders ?? [];
  const from = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  return (
    <Card aria-labelledby="orders-title" {...tid("orders.page")}>
      <CardHeader>
        <CardTitle as="h1" id="orders-title" className="text-base">
          Orders
        </CardTitle>
        <CardDescription>
          Seeded shop orders. Sort by a column header; filters and pages live in the URL.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <search aria-label="Orders">
            <form className="flex items-end gap-1" onSubmit={onSearch}>
              <div className="space-y-1">
                <Label htmlFor="orders-search">Search orders</Label>
                <Input
                  id="orders-search"
                  type="search"
                  placeholder="Order ID or customer"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="w-56"
                  {...tid("orders.search")}
                />
              </div>
              <Button type="submit" variant="outline" {...tid("orders.search.submit")}>
                <Search aria-hidden="true" className="size-3.5" />
                Search
              </Button>
            </form>
          </search>
          <div className="space-y-1">
            <Label htmlFor="orders-status">Status</Label>
            <NativeSelect
              id="orders-status"
              value={query.status ?? ""}
              onChange={(e) => {
                const parsed = OrderStatus.safeParse(e.target.value);
                update({ status: parsed.success ? parsed.data : undefined, page: 1 });
              }}
              {...tid("orders.filter.status")}
            >
              <option value="">All statuses</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
          {filtered ? (
            <Button
              variant="ghost"
              onClick={() => {
                setSearchText("");
                update({ status: undefined, q: "", page: 1 });
              }}
              {...tid("orders.filter.clear")}
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        {selected.size > 0 ? (
          <div
            role="toolbar"
            aria-label="Bulk actions"
            className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-accent-soft px-3 py-2"
            {...tid("orders.bulk")}
          >
            <span className="text-sm font-medium">{`${selected.size} selected`}</span>
            <Button
              size="sm"
              disabled={bulkPending}
              onClick={() => void bulk("shipped")}
              {...tid("orders.bulk.shipped")}
            >
              Mark as shipped
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkPending}
              onClick={() => void bulk("cancelled")}
              {...tid("orders.bulk.cancelled")}
            >
              Mark as cancelled
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              {...tid("orders.bulk.clear")}
            >
              Clear selection
            </Button>
          </div>
        ) : null}

        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <OrdersTable
          rows={rows}
          loading={data === undefined}
          sort={query.sort}
          dir={query.dir}
          onSort={sortBy}
          selected={selected}
          onSelect={setSelected}
          onAction={(kind, order) => setDialog({ kind, order })}
          caption={
            data
              ? `Orders, sorted by ${SORT_LABELS[query.sort]} ${query.dir === "asc" ? "ascending" : "descending"}, page ${data.page} of ${data.pageCount}`
              : "Orders"
          }
        />

        {data ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-muted" {...tid("orders.range")}>
              {data.total === 0
                ? "No orders"
                : `Showing ${from}–${to} of ${data.total} ${data.total === 1 ? "order" : "orders"}`}
            </p>
            <nav aria-label="Pagination" className="flex items-center gap-1" {...tid("orders.pagination")}>
              <Button
                size="sm"
                variant="outline"
                disabled={data.page <= 1}
                onClick={() => update({ page: data.page - 1 })}
                {...tid("orders.page.prev")}
              >
                Previous
              </Button>
              {Array.from({ length: data.pageCount }, (_, i) => i + 1).map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={n === data.page ? "default" : "ghost"}
                  aria-label={`Page ${n}`}
                  aria-current={n === data.page ? "page" : undefined}
                  onClick={() => update({ page: n })}
                  {...tid(`orders.page.${n}`)}
                >
                  {n}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                disabled={data.page >= data.pageCount}
                onClick={() => update({ page: data.page + 1 })}
                {...tid("orders.page.next")}
              >
                Next
              </Button>
            </nav>
          </div>
        ) : null}
      </CardContent>

      <OrderEditDialog
        order={dialog?.kind === "edit" ? dialog.order : null}
        onClose={() => setDialog(null)}
        onSaved={onSaved}
      />
      <OrderNotesDrawer
        order={dialog?.kind === "notes" ? dialog.order : null}
        onClose={() => setDialog(null)}
        onSaved={onSaved}
      />
      <OrderDeleteDialog
        order={dialog?.kind === "delete" ? dialog.order : null}
        onClose={() => setDialog(null)}
        onDeleted={onDeleted}
      />
    </Card>
  );
}
