// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Side drawer (a modal dialog anchored right) with order details and an editable note.
import { formatMoney, NOTE_MAX, ORDER_STATUS_LABELS } from "@ghosthand/testbed-kit/orders";
import { type FormEvent, useState } from "react";
import { api, type Order } from "../lib/api.ts";
import { tid } from "../lib/tid.ts";
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
import { Textarea } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";

export function OrderNotesDrawer({
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
        <DialogContent layout="drawer" {...tid("order.notes.drawer")}>
          <NotesForm key={order.id} order={order} onSaved={onSaved} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function NotesForm({ order, onSaved }: { order: Order; onSaved(order: Order, message: string): void }) {
  const [note, setNote] = useState(order.note);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (note.trim().length > NOTE_MAX) {
      setError(`Notes can be at most ${NOTE_MAX} characters.`);
      return;
    }
    setError(undefined);
    setPending(true);
    const res = await api.saveNote(order.id, note);
    setPending(false);
    if (!res.ok) {
      setError(res.fieldErrors ? Object.values(res.fieldErrors).join(" ") : res.message);
      return;
    }
    onSaved(res.value.order, res.value.message);
  }

  return (
    <form className="flex h-full min-h-0 flex-col" onSubmit={(e) => void onSubmit(e)} noValidate>
      <DialogHeader>
        <DialogTitle>{`Notes for order ${order.id}`}</DialogTitle>
        <DialogDescription>Notes are visible to everyone on the team.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Customer</dt>
          <dd>{order.customerName}</dd>
          <dt className="text-muted">Placed on</dt>
          <dd className="font-mono">{order.placedOn}</dd>
          <dt className="text-muted">Amount</dt>
          <dd className="font-mono">{formatMoney(order.amountCents)}</dd>
          <dt className="text-muted">Status</dt>
          <dd>{ORDER_STATUS_LABELS[order.status]}</dd>
        </dl>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div className="space-y-1">
          <Label htmlFor="order-note">Note</Label>
          <Textarea
            id="order-note"
            name="note"
            rows={5}
            value={note}
            aria-describedby="order-note-hint"
            onChange={(e) => setNote(e.target.value)}
            {...tid("order.notes.note")}
          />
          <p id="order-note-hint" className="text-xs text-muted">{`Up to ${NOTE_MAX} characters.`}</p>
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" {...tid("order.notes.cancel")}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending} {...tid("order.notes.save")}>
          {pending ? "Saving…" : "Save note"}
        </Button>
      </DialogFooter>
    </form>
  );
}
