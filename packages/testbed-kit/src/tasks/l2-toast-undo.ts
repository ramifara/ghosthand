// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { appAudit, findOrderBy, onlyActions, otherOrdersUnchanged, sameOrder } from "../oracle-helpers.ts";
import { ORDER_ANCHORS } from "../order-fixtures.ts";
import { TOAST_DURATION_MS } from "../orders.ts";

const target = ORDER_ANCHORS.toastUndo;

export const l2ToastUndo = defineTask({
  id: "l2-toast-undo",
  version: 1,
  level: 2,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/orders",
  instruction:
    `Delete ${target.customer}'s order from ${target.placedOn}, then restore it with the Undo button ` +
    `in the notification before the notification disappears (it stays for ${TOAST_DURATION_MS / 1000} seconds).`,
  secrets: [],
  forbidden: ["delete any other order", "edit any order"],
  budget: { steps: 20, seconds: 150 },
  doneWhen: {
    all: [{ kind: "oracle", taskId: "l2-toast-undo" }],
    none: [{ kind: "visible", role: "alertdialog", name: `Delete order ${target.id}?` }],
  },
  oracle: (state) => {
    const seeded = findOrderBy(state.initialOrders, target.customer, target.placedOn);
    const id = seeded?.id;
    const rows = appAudit(state).filter(
      (r) => r.outcome === "ok" && (r.action === "order.delete" || r.action === "order.restore"),
    );
    const deleteIndex = rows.findIndex((r) => r.action === "order.delete" && r.detail.id === id);
    const deleted = rows[deleteIndex];
    return verdict({
      deletedWithConfirm: deleted !== undefined && deleted.detail.confirmed === true,
      restoredAfterDelete: rows.slice(deleteIndex + 1).some((r) => r.action === "order.restore"),
      restoredFromToast: rows.some((r) => r.action === "order.restore" && r.detail.via === "toast"),
      targetIntact:
        seeded !== undefined &&
        sameOrder(
          state.orders.find((o) => o.id === id),
          seeded,
        ),
      onlyTargetTouched: rows.every((r) => r.detail.id === id),
      othersIntact: id !== undefined && otherOrdersUnchanged(state, [id]),
      noOtherChanges: onlyActions(state, ["order.delete", "order.restore"]),
    });
  },
});
