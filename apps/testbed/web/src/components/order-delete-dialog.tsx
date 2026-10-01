// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Confirm dialog in front of a destructive delete. Only this dialog sends `confirmed: true`.
import { formatMoney } from "@ghosthand/testbed-kit/orders";
import { useState } from "react";
import { api, type Order } from "../lib/api.ts";
import { tid } from "../lib/tid.ts";
import { Alert } from "./ui/alert.tsx";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./ui/alert-dialog.tsx";
import { Button } from "./ui/button.tsx";

export function OrderDeleteDialog({
  order,
  onClose,
  onDeleted,
}: {
  order: Order | null;
  onClose(): void;
  onDeleted(order: Order, message: string): void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function confirm() {
    if (!order) return;
    setPending(true);
    const res = await api.deleteOrder(order.id);
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setError(undefined);
    onDeleted(order, res.value.message);
  }

  return (
    <AlertDialog
      open={order !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(undefined);
          onClose();
        }
      }}
    >
      {order ? (
        <AlertDialogContent {...tid("order.delete.dialog")}>
          <AlertDialogTitle>{`Delete order ${order.id}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {`This removes the order for ${order.customerName} placed on ${order.placedOn} (${formatMoney(order.amountCents)}).`}
          </AlertDialogDescription>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline" {...tid("order.delete.cancel")}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button
              className="bg-bad text-white"
              disabled={pending}
              onClick={() => void confirm()}
              {...tid("order.delete.confirm")}
            >
              {pending ? "Deleting…" : "Delete order"}
            </Button>
          </div>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  );
}
