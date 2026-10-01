// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Modal edit form for one order: customer (async combobox), status (select) and tags (multi-select).
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  type OrderPatch,
  OrderStatus,
} from "@ghosthand/testbed-kit/orders";
import { type FormEvent, useState } from "react";
import { api, type Customer, type Order } from "../lib/api.ts";
import { formatOrderSummary } from "../lib/order-format.ts";
import { tid } from "../lib/tid.ts";
import { CustomerCombobox } from "./customer-combobox.tsx";
import { TagMultiSelect } from "./tag-multi-select.tsx";
import { Alert } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Label } from "./ui/label.tsx";
import { NativeSelect } from "./ui/select.tsx";

export function OrderEditDialog({
  order,
  onClose,
  onSaved,
}: {
  order: Order | null;
  onClose(): void;
  onSaved(order: Order, message: string): void;
}) {
  return (
    <Dialog open={order !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {order ? (
        <DialogContent
          onEscapeKeyDown={(e) => {
            // Escape in an open combobox or listbox closes that popup, not the whole dialog.
            const target = e.target instanceof HTMLElement ? e.target : null;
            if (
              target?.getAttribute("aria-expanded") === "true" ||
              target?.getAttribute("role") === "listbox"
            ) {
              e.preventDefault();
            }
          }}
          {...tid("order.edit.dialog")}
        >
          <EditForm key={order.id} order={order} onSaved={onSaved} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function EditForm({ order, onSaved }: { order: Order; onSaved(order: Order, message: string): void }) {
  const [customer, setCustomer] = useState<Customer | null>({
    id: order.customerId,
    name: order.customerName,
    email: "",
  });
  const [status, setStatus] = useState(order.status);
  const [tags, setTags] = useState(order.tags);
  const [customerError, setCustomerError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(undefined);
    if (!customer) {
      setCustomerError("Pick a customer from the list.");
      return;
    }
    setCustomerError(undefined);
    const patch: OrderPatch = {};
    if (customer.id !== order.customerId) patch.customerId = customer.id;
    if (status !== order.status) patch.status = status;
    if (tags.join(",") !== order.tags.join(",")) patch.tags = tags;
    if (Object.keys(patch).length === 0) {
      onSaved(order, "No changes to save.");
      return;
    }
    setPending(true);
    const res = await api.updateOrder(order.id, patch);
    setPending(false);
    if (!res.ok) {
      if (res.fieldErrors && "customer" in res.fieldErrors)
        setCustomerError(String(res.fieldErrors.customer));
      else setFormError(res.message);
      return;
    }
    onSaved(res.value.order, res.value.message);
  }

  return (
    <form className="flex min-h-0 flex-col" onSubmit={(e) => void onSubmit(e)} noValidate>
      <DialogHeader>
        <DialogTitle>{`Edit order ${order.id}`}</DialogTitle>
        <DialogDescription>{formatOrderSummary(order)}</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <div className="space-y-1">
          <Label htmlFor="order-edit-customer">Customer</Label>
          <CustomerCombobox
            id="order-edit-customer"
            value={customer}
            onChange={setCustomer}
            invalid={customerError !== undefined}
            describedBy={customerError ? "order-edit-customer-error" : "order-edit-customer-hint"}
          />
          {customerError ? (
            <p id="order-edit-customer-error" className="text-xs text-bad">
              {customerError}
            </p>
          ) : (
            <p id="order-edit-customer-hint" className="text-xs text-muted">
              Type to search, then pick a customer.
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="order-edit-status">Status</Label>
          <NativeSelect
            id="order-edit-status"
            value={status}
            onChange={(e) => setStatus(OrderStatus.parse(e.target.value))}
            className="w-full"
            {...tid("order.edit.status")}
          >
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label id="order-edit-tags-label" htmlFor="order-edit-tags">
            Tags
          </Label>
          <TagMultiSelect
            id="order-edit-tags"
            labelId="order-edit-tags-label"
            value={tags}
            onChange={setTags}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" {...tid("order.edit.cancel")}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending} {...tid("order.edit.save")}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
