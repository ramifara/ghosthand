// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L2/L3 app routes: the orders table, row actions, bulk status, customer search and the revenue report.
import {
  BulkStatusInput,
  IsoDate,
  NOTE_MAX,
  ORDER_STATUS_LABELS,
  OrderPatch,
  OrdersQuery,
  queryOrders,
  revenueBetween,
} from "@ghosthand/testbed-kit";
import type { Context, Hono } from "hono";
import type { Env } from "./audit-middleware.ts";
import { readJson } from "./read-json.ts";
import { sortTags, type Testbed } from "./testbed.ts";

/** Customer search answers after this delay, so the combobox is really async. */
export const CUSTOMER_SEARCH_DELAY_MS = 250;
const CUSTOMER_SEARCH_LIMIT = 8;

function unauthenticated(c: Context<Env>, action: string) {
  c.set("audit", { action, detail: { reason: "unauthenticated" } });
  return c.json({ error: "Sign in to manage orders." }, 401);
}

export function registerOrderRoutes(app: Hono<Env>, testbed: Testbed): void {
  app.get("/orders", (c) => {
    if (!c.get("user")) return c.json({ error: "Sign in to see orders." }, 401);
    const query = OrdersQuery.parse({
      page: c.req.query("page"),
      sort: c.req.query("sort"),
      dir: c.req.query("dir"),
      status: c.req.query("status"),
      q: c.req.query("q"),
    });
    return c.json(queryOrders(testbed.orders(), query));
  });

  app.get("/orders/:id", (c) => {
    if (!c.get("user")) return c.json({ error: "Sign in to see orders." }, 401);
    const order = testbed.order(c.req.param("id"));
    if (!order || order.deletedAt !== null) return c.json({ error: "Order not found." }, 404);
    return c.json({ order });
  });

  app.patch("/orders/:id", async (c) => {
    const action = "order.update";
    if (!c.get("user")) return unauthenticated(c, action);
    const id = c.req.param("id");
    const order = testbed.order(id);
    if (!order || order.deletedAt !== null) {
      c.set("audit", { action, detail: { id, reason: "not_found" } });
      return c.json({ error: "Order not found." }, 404);
    }
    const parsed = OrderPatch.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      c.set("audit", { action, detail: { id, reason: "invalid" } });
      return c.json({ error: "Those changes aren't valid." }, 400);
    }
    const patch = parsed.data;
    if (patch.customerId !== undefined) {
      const exists = testbed.customers().some((cu) => cu.id === patch.customerId);
      if (!exists) {
        c.set("audit", { action, detail: { id, reason: "unknown_customer" } });
        return c.json(
          { error: "validation", fieldErrors: { customer: "Pick a customer from the list." } },
          400,
        );
      }
    }
    const next = {
      customerId: patch.customerId ?? order.customerId,
      status: patch.status ?? order.status,
      tags: sortTags(patch.tags ?? order.tags),
    };
    const changed: string[] = [];
    if (next.customerId !== order.customerId) changed.push("customer");
    if (next.status !== order.status) changed.push("status");
    if (next.tags.join(",") !== order.tags.join(",")) changed.push("tags");
    testbed.db
      .query("update orders set customer_id = $customerId, status = $status, tags = $tags where id = $id")
      .run({ ...next, tags: JSON.stringify(next.tags), id });
    c.set("audit", { action, detail: { id, changed, ...next } });
    return c.json({ order: testbed.order(id), message: `Order ${id} updated.` });
  });

  app.put("/orders/:id/note", async (c) => {
    const action = "order.note";
    if (!c.get("user")) return unauthenticated(c, action);
    const id = c.req.param("id");
    const order = testbed.order(id);
    if (!order || order.deletedAt !== null) {
      c.set("audit", { action, detail: { id, reason: "not_found" } });
      return c.json({ error: "Order not found." }, 404);
    }
    const body = await readJson(c.req.raw);
    const note = typeof body.note === "string" ? body.note.trim() : undefined;
    if (note === undefined || note.length > NOTE_MAX) {
      c.set("audit", { action, detail: { id, reason: "invalid" } });
      return c.json(
        { error: "validation", fieldErrors: { note: `Notes can be at most ${NOTE_MAX} characters.` } },
        400,
      );
    }
    testbed.db.query("update orders set note = $note where id = $id").run({ note, id });
    c.set("audit", { action, detail: { id, length: note.length } });
    return c.json({ order: testbed.order(id), message: "Note saved." });
  });

  app.delete("/orders/:id", async (c) => {
    const action = "order.delete";
    if (!c.get("user")) return unauthenticated(c, action);
    const id = c.req.param("id");
    const order = testbed.order(id);
    if (!order || order.deletedAt !== null) {
      c.set("audit", { action, detail: { id, reason: "not_found" } });
      return c.json({ error: "Order not found." }, 404);
    }
    // The UI only sends this from the confirm dialog; the oracle checks it was there.
    const body = await readJson(c.req.raw);
    if (body.confirmed !== true) {
      c.set("audit", { action, detail: { id, reason: "unconfirmed", confirmed: false } });
      return c.json({ error: "Confirm the deletion first." }, 400);
    }
    testbed.db
      .query("update orders set deleted_at = $at where id = $id")
      .run({ at: testbed.clock.now(), id });
    c.set("audit", { action, detail: { id, confirmed: true } });
    return c.json({ id, message: `Order ${id} deleted.` });
  });

  app.post("/orders/:id/restore", async (c) => {
    const action = "order.restore";
    if (!c.get("user")) return unauthenticated(c, action);
    const id = c.req.param("id");
    const order = testbed.order(id);
    if (!order || order.deletedAt === null) {
      c.set("audit", { action, detail: { id, reason: "not_deleted" } });
      return c.json({ error: "That order isn't deleted." }, 409);
    }
    const body = await readJson(c.req.raw);
    testbed.db.query("update orders set deleted_at = null where id = $id").run({ id });
    c.set("audit", { action, detail: { id, via: typeof body.via === "string" ? body.via : "api" } });
    return c.json({ order: testbed.order(id), message: `Order ${id} restored.` });
  });

  app.post("/orders/bulk-status", async (c) => {
    const action = "order.bulk_status";
    if (!c.get("user")) return unauthenticated(c, action);
    const parsed = BulkStatusInput.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      c.set("audit", { action, detail: { reason: "invalid" } });
      return c.json({ error: "Select at least one order." }, 400);
    }
    const { ids, status } = parsed.data;
    const live = ids.map((id) => testbed.order(id)).filter((o) => o !== undefined && o.deletedAt === null);
    if (live.length !== new Set(ids).size) {
      c.set("audit", { action, detail: { ids, status, reason: "not_found" } });
      return c.json({ error: "Some selected orders no longer exist." }, 404);
    }
    const changed = live.filter((o) => o?.status !== status).map((o) => o?.id ?? "");
    const update = testbed.db.query("update orders set status = $status where id = $id");
    testbed.db.transaction(() => {
      for (const id of changed) update.run({ status, id });
    })();
    c.set("audit", { action, detail: { ids, status, changed } });
    const label = ORDER_STATUS_LABELS[status].toLowerCase();
    const noun = ids.length === 1 ? "order" : "orders";
    return c.json({ changed, message: `${ids.length} ${noun} marked as ${label}.` });
  });

  app.get("/customers", async (c) => {
    if (!c.get("user")) return c.json({ error: "Sign in to search customers." }, 401);
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    await new Promise((resolve) => setTimeout(resolve, CUSTOMER_SEARCH_DELAY_MS));
    const customers = testbed
      .customers()
      .filter((cu) => q === "" || cu.name.toLowerCase().includes(q))
      .slice(0, CUSTOMER_SEARCH_LIMIT);
    return c.json({ customers });
  });

  app.get("/reports/revenue", (c) => {
    if (!c.get("user")) return c.json({ error: "Sign in to see reports." }, 401);
    const from = IsoDate.safeParse(c.req.query("from"));
    const to = IsoDate.safeParse(c.req.query("to"));
    if (!from.success || !to.success) return c.json({ error: "Enter both dates as YYYY-MM-DD." }, 400);
    if (from.data > to.data)
      return c.json({ error: "The start date must be on or before the end date." }, 400);
    return c.json(revenueBetween(testbed.orders(), from.data, to.data));
  });
}
