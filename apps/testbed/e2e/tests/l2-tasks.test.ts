// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L2 data UI: performs each task like a person and checks the oracle fails before and passes after.
import {
  formatMoney,
  L2_DRAWER_NOTE,
  l2OrdersDeleteRow,
  l2OrdersDrawerNote,
  l2OrdersEditStatus,
  l2OrdersFilterBulk,
  l2OrdersSortFind,
  l2ToastUndo,
  ORDER_ANCHORS,
  PENDING_ORDER_COUNT,
  TOAST_DURATION_MS,
} from "@ghosthand/testbed-kit";
import { expect, test } from "@playwright/test";
import {
  control,
  expectOracleFails,
  expectOraclePasses,
  oracle,
  orderRow,
  orderRowFor,
  prepare,
  unwrap,
} from "./control.ts";

test("l2-orders-delete-row: delete one row through the confirm dialog; the toast goes away", async ({
  page,
  context,
}) => {
  const target = ORDER_ANCHORS.deleteTarget;
  await prepare(l2OrdersDeleteRow, context, page);
  await expectOracleFails(l2OrdersDeleteRow.id);

  const row = orderRowFor(page, target.customer, target.placedOn);
  await expect(row).toHaveCount(1);
  // Every row has an identical "Delete" button; only the row tells them apart.
  expect(await page.getByRole("button", { name: "Delete", exact: true }).count()).toBeGreaterThan(1);
  await row.getByRole("button", { name: "Delete", exact: true }).click();

  const confirm = page.getByRole("alertdialog", { name: `Delete order ${target.id}?` });
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveAttribute("aria-modal", "true");
  await confirm.getByRole("button", { name: "Delete order" }).click();
  await expect(confirm).toBeHidden();

  const toast = page.getByRole("status").filter({ hasText: `Order ${target.id} deleted.` });
  await expect(toast).toBeVisible();
  await expect(orderRow(page, target.id)).toHaveCount(0);
  await expectOraclePasses(l2OrdersDeleteRow.id);

  await expect(page.getByText(`Order ${target.id} deleted.`)).toBeHidden({
    timeout: TOAST_DURATION_MS + 3000,
  });
});

test("l2-orders-edit-status: change the status in the modal edit form", async ({ page, context }) => {
  const id = ORDER_ANCHORS.editStatus.id;
  await prepare(l2OrdersEditStatus, context, page);
  await expectOracleFails(l2OrdersEditStatus.id);

  // Page 1 holds ord_1001 to ord_1010.
  await page.getByRole("navigation", { name: "Pagination" }).getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Showing 11–20 of 50 orders")).toBeVisible();
  await orderRow(page, id).getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Edit order ${id}` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await dialog.getByLabel("Status").selectOption({ label: "Cancelled" });
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: `Order ${id} updated.` })).toBeVisible();
  await expect(orderRow(page, id)).toContainText("Cancelled");
  await expectOraclePasses(l2OrdersEditStatus.id);
});

test("l2-orders-sort-find: sort by date, newest first, and read page 2", async ({ page, context }) => {
  await prepare(l2OrdersSortFind, context, page);
  const sortButton = page.getByRole("button", { name: "Placed on" });
  await sortButton.click();
  await expect(page.getByRole("columnheader", { name: "Placed on" })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await sortButton.click();
  await expect(page.getByRole("columnheader", { name: "Placed on" })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await page.getByRole("navigation", { name: "Pagination" }).getByRole("button", { name: "Page 2" }).click();
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  await expect(page).toHaveURL(/[?&]sort=placedOn(&|$)/);
  await expect(page).toHaveURL(/[?&]dir=desc(&|$)/);
  await expect(page.getByText("Showing 11–20 of 50 orders")).toBeVisible();

  const rows = page.getByRole("row").filter({ has: page.getByRole("rowheader") });
  await expect(rows).toHaveCount(10);
  let best = { id: "", cents: -1 };
  for (const row of await rows.all()) {
    const id = (await row.getByRole("rowheader").textContent()) ?? "";
    const amount = (await row.getByRole("cell").nth(3).textContent()) ?? "";
    const cents = Math.round(Number(amount.replace(/[$,]/g, "")) * 100);
    expect(formatMoney(cents)).toBe(amount);
    if (cents > best.cents) best = { id, cents };
  }
  await expectOracleFails(l2OrdersSortFind.id, "ord_1001");
  await expectOraclePasses(l2OrdersSortFind.id, `The highest amount on page 2 belongs to ${best.id}.`);
});

test("l2-orders-filter-bulk: filter to pending, select all, mark shipped", async ({ page, context }) => {
  await prepare(l2OrdersFilterBulk, context, page);
  await expectOracleFails(l2OrdersFilterBulk.id);

  await page.getByLabel("Status").selectOption({ label: "Pending" });
  await expect(page).toHaveURL(/[?&]status=pending(&|$)/);
  const rows = page.getByRole("row").filter({ has: page.getByRole("rowheader") });
  await expect(rows).toHaveCount(PENDING_ORDER_COUNT);

  await page.getByRole("checkbox", { name: "Select all orders on this page" }).check();
  const bulk = page.getByRole("toolbar", { name: "Bulk actions" });
  await expect(bulk).toContainText(`${PENDING_ORDER_COUNT} selected`);
  await bulk.getByRole("button", { name: "Mark as shipped" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: `${PENDING_ORDER_COUNT} orders marked as shipped.` }),
  ).toBeVisible();
  await expect(page.getByText("No orders match these filters.")).toBeVisible();
  await expectOraclePasses(l2OrdersFilterBulk.id);
});

test("l2-orders-drawer-note: save a note from the side drawer", async ({ page, context }) => {
  const id = ORDER_ANCHORS.drawerNote.id;
  await prepare(l2OrdersDrawerNote, context, page);
  await expectOracleFails(l2OrdersDrawerNote.id);

  await orderRow(page, id).getByRole("button", { name: "Notes", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: `Notes for order ${id}` });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Note").fill(L2_DRAWER_NOTE);
  await drawer.getByRole("button", { name: "Save note" }).click();

  await expect(drawer).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Note saved." })).toBeVisible();
  await expectOraclePasses(l2OrdersDrawerNote.id);
});

test("l2-toast-undo: delete, then Undo from the toast before it disappears", async ({ page, context }) => {
  const target = ORDER_ANCHORS.toastUndo;
  await prepare(l2ToastUndo, context, page);
  await expectOracleFails(l2ToastUndo.id);

  // Lior Weber's order isn't on page 1 in id order; search narrows the table.
  await page.getByLabel("Search orders").fill(target.customer);
  await page.getByRole("button", { name: "Search" }).click();
  await orderRowFor(page, target.customer, target.placedOn)
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete order" }).click();

  const toast = page.getByRole("status").getByText(`Order ${target.id} deleted.`);
  await expect(toast).toBeVisible();
  expect((await oracle(l2ToastUndo.id)).checks.restoredAfterDelete).toBe(false);
  await page.getByRole("button", { name: "Undo" }).click();

  await expect(page.getByRole("status").filter({ hasText: `Order ${target.id} restored.` })).toBeVisible();
  await expect(orderRow(page, target.id)).toHaveCount(1);
  await expectOraclePasses(l2ToastUndo.id);
  expect(unwrap(await control.state()).orders.find((o) => o.id === target.id)?.deletedAt).toBeNull();
});
