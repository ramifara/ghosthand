// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L2/L3: orders, settings and bio routes, and every L2/L3 oracle (fails on a fresh reset, passes after).
import { beforeEach, describe, expect, test } from "bun:test";
import {
  ALICE_EMAIL,
  fixtureSecrets,
  L2_DRAWER_NOTE,
  L3_COMBOBOX_CUSTOMER,
  L3_EMAIL_LIMIT,
  L3_REPORT_RANGE,
  L3_TAGS_TO_ADD,
  l2SortFindExpected,
  ORDER_ANCHORS,
  ORDER_COUNT,
  type OracleResult,
  type OrderRow,
  type OrdersPage,
  PENDING_ORDER_COUNT,
  revenueBetween,
  SESSION_COOKIE,
} from "@ghosthand/testbed-kit";
import { createAppApi } from "./app-api.ts";
import { createControlApi } from "./control-api.ts";
import { ALICE_BIO_HTML } from "./shop-seed.ts";
import { Testbed } from "./testbed.ts";

let testbed: Testbed;
let app: ReturnType<typeof createAppApi>;
let control: ReturnType<typeof createControlApi>;
let cookie: string;

function send(target: { request: typeof app.request }, method: string, path: string, body?: unknown) {
  return target.request(path, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

function oracle(task: string, answer?: string): Promise<OracleResult> {
  const query = answer === undefined ? "" : `?answer=${encodeURIComponent(answer)}`;
  return json<OracleResult>(control.request(`/oracle/${task}${query}`));
}

async function expectPass(task: string, answer?: string): Promise<void> {
  const result = await oracle(task, answer);
  expect(result.checks).toEqual(Object.fromEntries(Object.keys(result.checks).map((k) => [k, true])));
  expect(result.pass).toBe(true);
}

beforeEach(async () => {
  testbed = new Testbed();
  app = createAppApi(testbed);
  control = createControlApi(testbed);
  cookie = "";
  const res = await send(app, "POST", "/api/login", {
    email: ALICE_EMAIL,
    password: fixtureSecrets.TESTBED_PASSWORD,
  });
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(res.headers.get("set-cookie") ?? "");
  cookie = `${SESSION_COOKIE}=${match?.[1] ?? ""}`;
});

describe("shop seed", () => {
  test("two resets with the same seed give identical orders; another seed differs", async () => {
    await send(control, "POST", "/reset", { seed: 7 });
    const first = await json<Record<string, unknown[]>>(control.request("/dump"));
    await send(control, "POST", "/reset", { seed: 7 });
    const second = await json<Record<string, unknown[]>>(control.request("/dump"));
    expect(second.orders).toEqual(first.orders);
    expect(second.customers).toEqual(first.customers);
    expect(second.user_settings).toEqual(first.user_settings);
    expect(second.bios).toEqual(first.bios);
    await send(control, "POST", "/reset", { seed: 8 });
    const other = await json<Record<string, unknown[]>>(control.request("/dump"));
    expect(other.orders).not.toEqual(first.orders);
  });

  test("50 orders, 7 pending, pinned anchors, unambiguous customer+date pairs", () => {
    for (const seed of [1, 7, 42, 1234]) {
      testbed.reset({ seed });
      const orders = testbed.orders();
      expect(orders).toHaveLength(ORDER_COUNT);
      expect(orders.filter((o) => o.status === "pending")).toHaveLength(PENDING_ORDER_COUNT);
      expect(new Set(orders.map((o) => o.amountCents)).size).toBe(ORDER_COUNT);
      for (const a of Object.values(ORDER_ANCHORS)) {
        const row = orders.find((o) => o.id === a.id);
        expect(row).toMatchObject({ customerName: a.customer, placedOn: a.placedOn, status: a.status });
        const sameKey = orders.filter((o) => o.customerName === a.customer && o.placedOn === a.placedOn);
        expect(sameKey).toHaveLength(1);
      }
    }
  });

  test("users and facts are unchanged by the shop seed (L1 stays frozen)", () => {
    const users = testbed.users();
    expect(users.map((u) => u.handle).slice(0, 2)).toEqual(["alice", "bob"]);
    expect(users).toHaveLength(10);
    expect(testbed.bios()).toEqual([{ userId: 1, html: ALICE_BIO_HTML }]);
  });
});

describe("orders API", () => {
  test("needs a session", async () => {
    cookie = "";
    expect((await send(app, "GET", "/api/orders")).status).toBe(401);
    expect((await send(app, "DELETE", "/api/orders/ord_1007", { confirmed: true })).status).toBe(401);
  });

  test("pages, sorts and filters on the server", async () => {
    const page1 = await json<OrdersPage>(send(app, "GET", "/api/orders"));
    expect(page1).toMatchObject({ total: 50, page: 1, pageCount: 5, pageSize: 10 });
    expect(page1.orders[0]?.id).toBe("ord_1001");
    const byDate = await json<OrdersPage>(send(app, "GET", "/api/orders?page=2&sort=placedOn&dir=desc"));
    const dates = byDate.orders.map((o) => o.placedOn);
    expect(dates).toEqual([...dates].sort().reverse());
    const pending = await json<OrdersPage>(send(app, "GET", "/api/orders?status=pending"));
    expect(pending.total).toBe(PENDING_ORDER_COUNT);
    const bob = await json<OrdersPage>(send(app, "GET", "/api/orders?q=bob%20ng"));
    expect(bob.orders.every((o) => o.customerName === "Bob Ng")).toBe(true);
    const junk = await json<OrdersPage>(send(app, "GET", "/api/orders?page=99&sort=nope&dir=up"));
    expect(junk).toMatchObject({ page: 5, total: 50 });
  });

  test("delete needs confirmation; undo restores", async () => {
    const id = ORDER_ANCHORS.deleteTarget.id;
    expect((await send(app, "DELETE", `/api/orders/${id}`, {})).status).toBe(400);
    expect((await send(app, "DELETE", `/api/orders/${id}`, { confirmed: true })).status).toBe(200);
    expect((await json<OrdersPage>(send(app, "GET", "/api/orders"))).total).toBe(49);
    expect((await send(app, "DELETE", `/api/orders/${id}`, { confirmed: true })).status).toBe(404);
    expect((await send(app, "POST", `/api/orders/${id}/restore`, { via: "toast" })).status).toBe(200);
    expect((await send(app, "POST", `/api/orders/${id}/restore`, {})).status).toBe(409);
  });

  test("patch validates customers and fields", async () => {
    const id = ORDER_ANCHORS.editStatus.id;
    expect((await send(app, "PATCH", `/api/orders/${id}`, { customerId: 999 })).status).toBe(400);
    expect((await send(app, "PATCH", `/api/orders/${id}`, { status: "lost" })).status).toBe(400);
    expect((await send(app, "PATCH", `/api/orders/${id}`, { amountCents: 1 })).status).toBe(400);
    expect((await send(app, "PATCH", "/api/orders/ord_9999", { status: "paid" })).status).toBe(404);
  });

  test("customer search is async and filtered", async () => {
    const started = performance.now();
    const res = await json<{ customers: { name: string }[] }>(send(app, "GET", "/api/customers?q=mira"));
    expect(performance.now() - started).toBeGreaterThanOrEqual(200);
    expect(res.customers.map((c) => c.name)).toEqual(["Mira Varga", "Mira Vance", "Mirabel Quinn"]);
  });

  test("revenue report validates the range", async () => {
    expect((await send(app, "GET", "/api/reports/revenue?from=2026-02-01&to=2026-01-01")).status).toBe(400);
    expect((await send(app, "GET", "/api/reports/revenue?from=jan&to=2026-01-01")).status).toBe(400);
  });
});

describe("L2 oracles", () => {
  test("l2-orders-delete-row", async () => {
    const task = "l2-orders-delete-row";
    expect((await oracle(task)).pass).toBe(false);
    await send(app, "DELETE", `/api/orders/${ORDER_ANCHORS.deleteTarget.id}`, { confirmed: true });
    await expectPass(task);
  });

  test("l2-orders-delete-row fails when the same-date order is deleted instead", async () => {
    await send(app, "DELETE", `/api/orders/${ORDER_ANCHORS.deleteSameDate.id}`, { confirmed: true });
    const result = await oracle("l2-orders-delete-row");
    expect(result.checks.targetDeleted).toBe(false);
    expect(result.checks.othersIntact).toBe(false);
  });

  test("l2-orders-edit-status", async () => {
    const task = "l2-orders-edit-status";
    const id = ORDER_ANCHORS.editStatus.id;
    expect((await oracle(task)).pass).toBe(false);
    await send(app, "PATCH", `/api/orders/${id}`, { status: "cancelled", tags: ["gift"] });
    expect((await oracle(task)).checks.otherFieldsUnchanged).toBe(false);
    await send(app, "PATCH", `/api/orders/${id}`, { tags: [] });
    await expectPass(task);
  });

  test("l2-orders-sort-find", async () => {
    const task = "l2-orders-sort-find";
    const expected = l2SortFindExpected(testbed.orders());
    expect(expected).toBeDefined();
    expect((await oracle(task)).pass).toBe(false);
    expect((await oracle(task, "ord_1001")).pass).toBe(false);
    expect((await oracle(task, `ord_1001 and ${expected?.id}`)).pass).toBe(false);
    await expectPass(task, `The highest amount on page 2 is ${expected?.id}.`);
  });

  test("l2-orders-filter-bulk", async () => {
    const task = "l2-orders-filter-bulk";
    expect((await oracle(task)).pass).toBe(false);
    const pending = await json<OrdersPage>(send(app, "GET", "/api/orders?status=pending"));
    const ids = pending.orders.map((o) => o.id);
    const res = await json<{ message: string }>(
      send(app, "POST", "/api/orders/bulk-status", { ids, status: "shipped" }),
    );
    expect(res.message).toBe(`${PENDING_ORDER_COUNT} orders marked as shipped.`);
    await expectPass(task);
  });

  test("l2-orders-drawer-note", async () => {
    const task = "l2-orders-drawer-note";
    expect((await oracle(task)).pass).toBe(false);
    await send(app, "PUT", `/api/orders/${ORDER_ANCHORS.drawerNote.id}/note`, { note: L2_DRAWER_NOTE });
    await expectPass(task);
  });

  test("l2-toast-undo", async () => {
    const task = "l2-toast-undo";
    const id = ORDER_ANCHORS.toastUndo.id;
    expect((await oracle(task)).pass).toBe(false);
    await send(app, "DELETE", `/api/orders/${id}`, { confirmed: true });
    expect((await oracle(task)).checks.restoredAfterDelete).toBe(false);
    await send(app, "POST", `/api/orders/${id}/restore`, { via: "toast" });
    await expectPass(task);
  });
});

describe("L3 oracles", () => {
  test("l3-assign-customer-combobox", async () => {
    const task = "l3-assign-customer-combobox";
    expect((await oracle(task)).pass).toBe(false);
    const target = testbed.customers().find((c) => c.name === L3_COMBOBOX_CUSTOMER);
    const vance = testbed.customers().find((c) => c.name === "Mira Vance");
    const id = ORDER_ANCHORS.combobox.id;
    await send(app, "PATCH", `/api/orders/${id}`, { customerId: vance?.id });
    expect((await oracle(task)).checks.customerAssigned).toBe(false);
    await send(app, "PATCH", `/api/orders/${id}`, { customerId: target?.id });
    await expectPass(task);
  });

  test("l3-tags-multiselect", async () => {
    const task = "l3-tags-multiselect";
    expect((await oracle(task)).pass).toBe(false);
    const id = ORDER_ANCHORS.tags.id;
    const res = await json<{ order: OrderRow }>(
      send(app, "PATCH", `/api/orders/${id}`, { tags: [...L3_TAGS_TO_ADD, "gift"] }),
    );
    // Stored in canonical order whatever order the client sent.
    expect(res.order.tags).toEqual(["gift", "priority", "fragile"]);
    await expectPass(task);
  });

  test("l3-date-range-report", async () => {
    const task = "l3-date-range-report";
    const { from, to } = L3_REPORT_RANGE;
    const report = await json<{ totalCents: number }>(
      send(app, "GET", `/api/reports/revenue?from=${from}&to=${to}`),
    );
    expect(report.totalCents).toBe(revenueBetween(testbed.orders(), from, to).totalCents);
    expect((await oracle(task)).pass).toBe(false);
    expect((await oracle(task, "$1.00")).pass).toBe(false);
    const dollars = (report.totalCents / 100).toFixed(2);
    await expectPass(
      task,
      `Total revenue: $${Number(dollars).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    );
  });

  test("l3-settings-tabs-slider", async () => {
    const task = "l3-settings-tabs-slider";
    expect((await oracle(task)).pass).toBe(false);
    expect(
      (await send(app, "PUT", "/api/settings/notifications", { emailLimit: 47, digest: "weekly" })).status,
    ).toBe(400);
    await send(app, "PUT", "/api/settings/notifications", { emailLimit: L3_EMAIL_LIMIT, digest: "weekly" });
    await expectPass(task);
  });

  test("l3-settings-tabs-slider fails when the digest changes too", async () => {
    await send(app, "PUT", "/api/settings/notifications", { emailLimit: L3_EMAIL_LIMIT, digest: "daily" });
    expect((await oracle("l3-settings-tabs-slider")).checks.otherSettingsUnchanged).toBe(false);
  });

  test("l3-rich-text-bio sanitizes and checks bold", async () => {
    const task = "l3-rich-text-bio";
    expect((await oracle(task)).pass).toBe(false);
    const saved = await json<{ html: string }>(
      send(app, "PUT", "/api/bio", {
        html: '<p>I build test <b style="color:red">fixtures</b> for the GhostHand testbed.</p><div>Ask me about <i>flaky</i> selectors.<script>alert(1)</script></div>',
      }),
    );
    expect(saved.html).toBe(
      "<p>I build test <strong>fixtures</strong> for the GhostHand testbed.</p><p>Ask me about <em>flaky</em> selectors.</p>",
    );
    await expectPass(task);
  });

  test("l3-accordion-tooltip", async () => {
    const task = "l3-accordion-tooltip";
    expect((await oracle(task)).pass).toBe(false);
    await send(app, "POST", "/api/settings/webhook-secret/rotate", {});
    await expectPass(task);
    await send(app, "POST", "/api/settings/api-key/revoke", {});
    const after = await oracle(task);
    expect(after.checks.apiKeyKept).toBe(false);
    expect((await send(app, "POST", "/api/settings/api-key/revoke", {})).status).toBe(409);
  });
});
