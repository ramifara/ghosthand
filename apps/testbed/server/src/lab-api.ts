// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 lab routes under /api/lab: the same-origin side of the checkout, shadow-DOM preferences, promo codes,
// the canvas chart data, drag-and-drop lists, contacts upload/download, the feed, inventory and projects.
import {
  BOARD_COLUMNS,
  CANVAS_TARGET_SHAPES,
  CardMoveInput,
  ChecklistOrderInput,
  ContactsImportInput,
  contactsToCsv,
  DEFAULT_PREFS,
  DEFAULT_WORKSPACE,
  FEED_PAGE_SIZE,
  GIFT_NOTE_MAX,
  LAB_MESSAGES,
  labSignups,
  PROMO_CODES,
  PrefsInput,
  parseContactsCsv,
  TOOLBAR_PANES,
  WEEKDAYS,
  Workspace,
} from "@ghosthand/testbed-kit";
import type { Context, Hono } from "hono";
import type { Env } from "./audit-middleware.ts";
import { readContacts, readLab } from "./lab-db.ts";
import { readJson } from "./read-json.ts";
import type { Testbed } from "./testbed.ts";

/** Older feed pages answer after this delay, so the infinite scroll really waits for the network. */
export const FEED_DELAY_MS = 300;

function unauthenticated(c: Context<Env>, action: string) {
  c.set("audit", { action, detail: { reason: "unauthenticated" } });
  return c.json({ error: "Sign in to use the lab." }, 401);
}

const signedOut = (c: Context<Env>) => c.json({ error: "Sign in to use the lab." }, 401);

export function registerLabRoutes(app: Hono<Env>, testbed: Testbed): void {
  const workspaceOf = (userId: number): Workspace =>
    (testbed.db
      .query<{ workspace: string }, { userId: number }>(
        "select workspace from lab_workspaces where user_id = $userId",
      )
      .get({ userId })?.workspace as Workspace | undefined) ?? DEFAULT_WORKSPACE;

  // ---- checkout: gift message (the shipping widget is on the frame origin) -------------------------

  app.get("/lab/checkout", (c) => {
    const user = c.get("user");
    if (!user) return signedOut(c);
    const lab = readLab(testbed.db);
    return c.json({
      shipping: lab.shipping.find((s) => s.userId === user.id) ?? null,
      giftMessage: lab.giftNotes.find((g) => g.userId === user.id)?.message ?? "",
    });
  });

  app.put("/lab/gift-note", async (c) => {
    const action = "lab.gift_note";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const body = await readJson(c.req.raw);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > GIFT_NOTE_MAX) {
      c.set("audit", { action, detail: { reason: "invalid" } });
      return c.json({ error: `Write a message of 1 to ${GIFT_NOTE_MAX} characters.` }, 400);
    }
    testbed.db
      .query(
        `insert into lab_gift_notes (user_id, message) values ($id, $message)
         on conflict(user_id) do update set message = excluded.message`,
      )
      .run({ id: user.id, message });
    c.set("audit", { action, detail: { length: message.length } });
    return c.json({ message: LAB_MESSAGES.giftSaved });
  });

  // ---- notification preferences (open shadow root) ------------------------------------------------

  app.get("/lab/prefs", (c) => {
    const user = c.get("user");
    if (!user) return signedOut(c);
    const row = readLab(testbed.db).prefs.find((p) => p.userId === user.id);
    return c.json({
      prefs: row ? { digestAt: row.digestAt, weeklySummary: row.weeklySummary } : DEFAULT_PREFS,
    });
  });

  app.put("/lab/prefs", async (c) => {
    const action = "lab.prefs_save";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const parsed = PrefsInput.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      c.set("audit", { action, detail: { reason: "invalid" } });
      return c.json({ error: "Those preferences aren't valid." }, 400);
    }
    testbed.db
      .query(
        `insert into lab_prefs (user_id, digest_at, weekly_summary) values ($id, $digestAt, $weekly)
         on conflict(user_id) do update set digest_at = excluded.digest_at, weekly_summary = excluded.weekly_summary`,
      )
      .run({ id: user.id, digestAt: parsed.data.digestAt, weekly: parsed.data.weeklySummary ? 1 : 0 });
    c.set("audit", { action, detail: { ...parsed.data } });
    return c.json({ prefs: parsed.data, message: LAB_MESSAGES.prefsSaved });
  });

  // ---- promo code (closed shadow root) -------------------------------------------------------------

  app.get("/lab/promo", (c) => {
    const user = c.get("user");
    if (!user) return signedOut(c);
    const codes = readLab(testbed.db)
      .promos.filter((p) => p.userId === user.id)
      .map((p) => p.code);
    return c.json({ codes });
  });

  app.post("/lab/promo", async (c) => {
    const action = "lab.promo_apply";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const body = await readJson(c.req.raw);
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!(PROMO_CODES as readonly string[]).includes(code)) {
      c.set("audit", { action, detail: { code: code.slice(0, 40), reason: "unknown_code" } });
      return c.json({ error: LAB_MESSAGES.promoUnknown }, 400);
    }
    const already = testbed.db
      .query<{ id: number }, { id: number; code: string }>(
        "select id from lab_promos where user_id = $id and code = $code",
      )
      .get({ id: user.id, code });
    if (!already)
      testbed.db
        .query("insert into lab_promos (user_id, code) values ($id, $code)")
        .run({ id: user.id, code });
    c.set("audit", { action, detail: { code } });
    return c.json({ code, message: LAB_MESSAGES.promoApplied(code) });
  });

  // ---- sign-ups chart (canvas) ---------------------------------------------------------------------

  app.get("/lab/signups", (c) => {
    if (!c.get("user")) return signedOut(c);
    return c.json({ days: WEEKDAYS, counts: labSignups(testbed.seed) });
  });

  // ---- canvas target (ADR 0020: a control that exists only as paint) -------------------------------

  app.post("/lab/canvas-target", async (c) => {
    const action = "lab.canvas_target";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const body = await readJson(c.req.raw);
    const shape = typeof body.shape === "string" ? body.shape : "";
    if (!(CANVAS_TARGET_SHAPES as readonly string[]).includes(shape)) {
      c.set("audit", { action, detail: { shape: shape.slice(0, 40), reason: "miss" } });
      return c.json({ error: LAB_MESSAGES.canvasMiss }, 400);
    }
    c.set("audit", { action, detail: { shape } });
    return c.json({ shape, message: LAB_MESSAGES.canvasHit(shape) });
  });

  // ---- icon toolbar (ADR 0020: icon-only buttons; no names under a11y poor) -------------------------

  app.post("/lab/toolbar", async (c) => {
    const action = "lab.toolbar_open";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const body = await readJson(c.req.raw);
    const pane = typeof body.pane === "string" ? body.pane : "";
    if (!Object.hasOwn(TOOLBAR_PANES, pane)) {
      c.set("audit", { action, detail: { pane: pane.slice(0, 40), reason: "unknown_pane" } });
      return c.json({ error: "Unknown pane." }, 400);
    }
    const title = TOOLBAR_PANES[pane as keyof typeof TOOLBAR_PANES];
    c.set("audit", { action, detail: { pane } });
    return c.json({ pane, message: LAB_MESSAGES.paneOpened(title) });
  });

  // ---- release checklist (HTML5 drag and drop) -----------------------------------------------------

  app.get("/lab/checklist", (c) => {
    if (!c.get("user")) return signedOut(c);
    return c.json({ items: readLab(testbed.db).checklist });
  });

  app.put("/lab/checklist", async (c) => {
    const action = "lab.checklist_order";
    if (!c.get("user")) return unauthenticated(c, action);
    const parsed = ChecklistOrderInput.safeParse(await readJson(c.req.raw));
    const current = readLab(testbed.db).checklist.map((i) => i.id);
    const order = parsed.success ? parsed.data.order : [];
    if (order.length !== current.length || [...order].sort().join() !== [...current].sort().join()) {
      c.set("audit", { action, detail: { reason: "invalid" } });
      return c.json({ error: "The order must list every item once." }, 400);
    }
    const update = testbed.db.query("update lab_checklist set position = $position where id = $id");
    testbed.db.transaction(() => {
      order.forEach((id, position) => {
        update.run({ id, position });
      });
    })();
    c.set("audit", { action, detail: { order } });
    return c.json({ items: readLab(testbed.db).checklist, message: LAB_MESSAGES.checklistSaved });
  });

  // ---- board (pointer-events kanban) ---------------------------------------------------------------

  app.get("/lab/board", (c) => {
    if (!c.get("user")) return signedOut(c);
    return c.json({ columns: BOARD_COLUMNS, cards: readLab(testbed.db).cards });
  });

  app.patch("/lab/board/cards/:id", async (c) => {
    const action = "lab.card_move";
    if (!c.get("user")) return unauthenticated(c, action);
    const id = c.req.param("id");
    const cards = readLab(testbed.db).cards;
    const card = cards.find((x) => x.id === id);
    const parsed = CardMoveInput.safeParse(await readJson(c.req.raw));
    if (!card || !parsed.success) {
      c.set("audit", { action, detail: { id, reason: card ? "invalid" : "not_found" } });
      return c.json({ error: card ? "That move isn't valid." : "Card not found." }, card ? 400 : 404);
    }
    const { column } = parsed.data;
    const others = cards.filter((x) => x.column === column && x.id !== id);
    const position = Math.min(parsed.data.position, others.length);
    others.splice(position, 0, { ...card, column });
    const update = testbed.db.query(
      "update lab_cards set column_id = $column, position = $position where id = $id",
    );
    testbed.db.transaction(() => {
      others.forEach((x, i) => {
        update.run({ id: x.id, column, position: i });
      });
      // Close the gap the card left behind.
      cards
        .filter((x) => x.column === card.column && x.id !== id && card.column !== column)
        .forEach((x, i) => {
          update.run({ id: x.id, column: x.column, position: i });
        });
    })();
    const name = BOARD_COLUMNS.find((col) => col.id === column)?.name ?? column;
    c.set("audit", { action, detail: { id, from: card.column, to: column, position } });
    return c.json({ cards: readLab(testbed.db).cards, message: LAB_MESSAGES.cardMoved(card.title, name) });
  });

  // ---- contacts (file upload + CSV download) -------------------------------------------------------

  app.get("/lab/contacts", (c) => {
    if (!c.get("user")) return signedOut(c);
    return c.json({ contacts: readContacts(testbed.db) });
  });

  app.post("/lab/contacts/import", async (c) => {
    const action = "lab.contacts_import";
    if (!c.get("user")) return unauthenticated(c, action);
    const input = ContactsImportInput.safeParse(await readJson(c.req.raw));
    if (!input.success) {
      c.set("audit", { action, detail: { reason: "invalid" } });
      return c.json({ error: "Choose a CSV file first." }, 400);
    }
    const parsed = parseContactsCsv(input.data.csv);
    if (!parsed.ok) {
      c.set("audit", { action, detail: { filename: input.data.filename, reason: "bad_csv" } });
      return c.json({ error: parsed.error }, 400);
    }
    const insert = testbed.db.query(
      `insert or ignore into lab_contacts (name, email, company, source)
       values ($name, $email, $company, 'import')`,
    );
    let added = 0;
    testbed.db.transaction(() => {
      for (const row of parsed.rows) added += insert.run(row).changes;
    })();
    c.set("audit", { action, detail: { filename: input.data.filename, rows: parsed.rows.length, added } });
    return c.json({ contacts: readContacts(testbed.db), message: LAB_MESSAGES.imported(added) });
  });

  app.get("/lab/contacts/export.csv", (c) => {
    const user = c.get("user");
    if (!user) return signedOut(c);
    const rows = readContacts(testbed.db);
    // A download is a GET, which the audit middleware skips; it is recorded here on purpose.
    testbed.audit({
      actor: user.email,
      method: "GET",
      path: "/api/lab/contacts/export.csv",
      action: "lab.contacts_export",
      outcome: "ok",
      detail: { rows: rows.length },
    });
    return c.body(contactsToCsv(rows), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="contacts-export.csv"',
      "cache-control": "no-store",
    });
  });

  // ---- activity feed (infinite scroll) -------------------------------------------------------------

  app.get("/lab/activity", async (c) => {
    if (!c.get("user")) return signedOut(c);
    const cursor = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
    if (cursor > 0) await new Promise((resolve) => setTimeout(resolve, FEED_DELAY_MS));
    const rows = testbed.db
      .query<{ id: string; title: string; at: string; flagged: number }, { limit: number; offset: number }>(
        "select id, title, at, flagged from lab_events order by id limit $limit offset $offset",
      )
      .all({ limit: FEED_PAGE_SIZE, offset: cursor });
    const total = testbed.db.query<{ n: number }, []>("select count(*) as n from lab_events").get()?.n ?? 0;
    const next = cursor + rows.length < total ? cursor + rows.length : null;
    return c.json({ events: rows.map((r) => ({ ...r, flagged: r.flagged === 1 })), next, total });
  });

  app.post("/lab/activity/:id/flag", (c) => {
    const action = "lab.event_flag";
    if (!c.get("user")) return unauthenticated(c, action);
    const id = c.req.param("id");
    const row = testbed.db
      .query<{ title: string }, { id: string }>("select title from lab_events where id = $id")
      .get({ id });
    if (!row) {
      c.set("audit", { action, detail: { id, reason: "not_found" } });
      return c.json({ error: "Event not found." }, 404);
    }
    testbed.db.query("update lab_events set flagged = 1 where id = $id").run({ id });
    c.set("audit", { action, detail: { id } });
    return c.json({ id, message: LAB_MESSAGES.flagged(row.title) });
  });

  // ---- inventory (virtualized list) ----------------------------------------------------------------

  app.get("/lab/inventory", (c) => {
    if (!c.get("user")) return signedOut(c);
    const skus = testbed.db
      .query<{ id: string; name: string; stock: number; discontinued: number }, []>(
        "select id, name, stock, discontinued from lab_skus order by id",
      )
      .all()
      .map((r) => ({ ...r, discontinued: r.discontinued === 1 }));
    return c.json({ skus });
  });

  app.post("/lab/inventory/:id/discontinue", (c) => {
    const action = "lab.sku_discontinue";
    if (!c.get("user")) return unauthenticated(c, action);
    const id = c.req.param("id");
    const row = testbed.db
      .query<{ id: string }, { id: string }>("select id from lab_skus where id = $id")
      .get({ id });
    if (!row) {
      c.set("audit", { action, detail: { id, reason: "not_found" } });
      return c.json({ error: "SKU not found." }, 404);
    }
    testbed.db.query("update lab_skus set discontinued = 1 where id = $id").run({ id });
    c.set("audit", { action, detail: { id } });
    return c.json({ id, message: LAB_MESSAGES.discontinued(id) });
  });

  // ---- projects (hover menu + context menu) --------------------------------------------------------

  const projectsFor = (userId: number) => {
    const workspace = workspaceOf(userId);
    return {
      workspace,
      projects: readLab(testbed.db).projects.filter((p) => p.workspace === workspace && !p.archived),
    };
  };

  app.get("/lab/projects", (c) => {
    const user = c.get("user");
    if (!user) return signedOut(c);
    return c.json(projectsFor(user.id));
  });

  app.post("/lab/workspace", async (c) => {
    const action = "lab.workspace_switch";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const parsed = Workspace.safeParse((await readJson(c.req.raw)).workspace);
    if (!parsed.success) {
      c.set("audit", { action, detail: { reason: "invalid" } });
      return c.json({ error: "Pick a workspace from the menu." }, 400);
    }
    testbed.db
      .query(
        `insert into lab_workspaces (user_id, workspace) values ($id, $workspace)
         on conflict(user_id) do update set workspace = excluded.workspace`,
      )
      .run({ id: user.id, workspace: parsed.data });
    c.set("audit", { action, detail: { workspace: parsed.data } });
    return c.json({ ...projectsFor(user.id), message: LAB_MESSAGES.workspace(parsed.data) });
  });

  app.post("/lab/projects/:id/archive", async (c) => {
    const action = "lab.project_archive";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const id = c.req.param("id");
    const body = await readJson(c.req.raw);
    const via = typeof body.via === "string" ? body.via.slice(0, 40) : "api";
    const project = readLab(testbed.db).projects.find((p) => p.id === id && !p.archived);
    if (!project) {
      c.set("audit", { action, detail: { id, reason: "not_found" } });
      return c.json({ error: "Project not found." }, 404);
    }
    testbed.db.query("update lab_projects set archived = 1 where id = $id").run({ id });
    c.set("audit", { action, detail: { id, via } });
    return c.json({ ...projectsFor(user.id), message: LAB_MESSAGES.archived(project.name) });
  });
}
