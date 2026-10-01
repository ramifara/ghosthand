// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import type { AuditRow, TestbedState, UserRow } from "./control-schemas.ts";
import { ALICE_EMAIL } from "./fixtures.ts";
import {
  BOARD_CARDS,
  CHECKLIST_ITEMS,
  type ContactRow,
  contactsToCsv,
  EMPTY_LAB,
  FEED_PAGE_SIZE,
  FEED_TARGET,
  LAB_PROJECTS,
  type LabState,
  labFeedEvents,
  labSignups,
  labSkus,
  parseContactsCsv,
  SEED_CONTACTS,
  SKU_TARGET,
  UPLOAD_CONTACTS,
} from "./lab.ts";
import { answerStatesNumber } from "./lab-oracle-helpers.ts";
import { getTask, listTaskIds } from "./registry.ts";
import { l4CanvasChart, l4ChartExpected } from "./tasks/l4-canvas-chart.ts";
import { l4ClosedShadowPromo } from "./tasks/l4-closed-shadow-promo.ts";
import { L4_CHECKLIST_EXPECTED, l4DndChecklist } from "./tasks/l4-dnd-checklist.ts";
import { L4_GIFT_MESSAGE, L4_SHIPPING, l4IframeCheckout } from "./tasks/l4-iframe-checkout.ts";
import { l4InfiniteFeed } from "./tasks/l4-infinite-feed.ts";
import { l4KanbanMove } from "./tasks/l4-kanban-move.ts";
import { l4MenusProjects } from "./tasks/l4-menus-projects.ts";
import { L4_PREFS, l4ShadowPreferences } from "./tasks/l4-shadow-preferences.ts";
import { l4UploadContacts } from "./tasks/l4-upload-contacts.ts";
import { l4VirtualInventory } from "./tasks/l4-virtual-inventory.ts";

const alice: UserRow = {
  id: 1,
  email: ALICE_EMAIL,
  name: "Alice Archer",
  handle: "alice",
  title: "Engineer",
  website: "",
  bio: "",
};

const seededLab: LabState = {
  ...EMPTY_LAB,
  checklist: CHECKLIST_ITEMS.map((c, position) => ({ ...c, position })),
  cards: BOARD_CARDS.map((c, position) => ({ ...c, position })),
  contacts: SEED_CONTACTS.map((c, i) => ({ ...c, id: i + 1, source: "seed" as const })),
  projects: LAB_PROJECTS.map((p) => ({ ...p, archived: false })),
};

let auditId = 0;
function audit(action: string, detail: Record<string, unknown> = {}, outcome: AuditRow["outcome"] = "ok") {
  auditId += 1;
  return {
    id: auditId,
    at: "2026-03-02T09:00:00.000Z",
    actor: ALICE_EMAIL,
    method: "POST",
    path: "/api/lab/x",
    action,
    outcome,
    detail,
  } satisfies AuditRow;
}

function state(lab: Partial<LabState> = {}, auditRows: AuditRow[] = []): TestbedState {
  return {
    seed: 42,
    variant: { testids: "off", a11y: "good" },
    now: "2026-03-02T09:00:00.000Z",
    users: [alice],
    initialUsers: [alice],
    sessions: [],
    audit: auditRows,
    mail: [],
    customers: [],
    orders: [],
    initialOrders: [],
    settings: [],
    initialSettings: [],
    bios: [],
    initialBios: [],
    cart: [],
    pickupStores: [],
    lab: { ...seededLab, ...lab },
    initialLab: seededLab,
  };
}

describe("L4 registry", () => {
  it("registers ten L4 tasks; vision is required exactly for the canvas and the closed shadow root", () => {
    const l4 = listTaskIds().filter((id) => id.startsWith("l4-"));
    expect(l4).toHaveLength(10);
    const vision = l4.filter((id) => getTask(id)?.needsVision);
    expect(vision.sort()).toEqual(["l4-canvas-chart", "l4-closed-shadow-promo"]);
    expect(l4IframeCheckout.allowOrigins).toHaveLength(1);
    expect(l4IframeCheckout.allowOrigins[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("every L4 oracle fails on the untouched seed (and without a lab snapshot at all)", () => {
    for (const id of listTaskIds().filter((t) => t.startsWith("l4-"))) {
      const task = getTask(id);
      expect(task?.oracle(state(), {}).pass, id).toBe(false);
      const bare = { ...state() };
      delete bare.lab;
      delete bare.initialLab;
      expect(task?.oracle(bare, {}).pass, id).toBe(false);
    }
  });
});

describe("lab fixtures", () => {
  it("generates the same data for the same seed", () => {
    expect(labFeedEvents(42)).toEqual(labFeedEvents(42));
    expect(labSkus(42)).toEqual(labSkus(42));
    expect(labSignups(7)).not.toEqual(labSignups(8));
  });

  it("puts the feed target in the fourth page with a unique title", () => {
    const events = labFeedEvents(42);
    const at = events.findIndex((e) => e.id === FEED_TARGET.id);
    expect(Math.floor(at / FEED_PAGE_SIZE)).toBe(3);
    expect(events[at]?.title).toBe(FEED_TARGET.title);
    expect(new Set(events.map((e) => e.title)).size).toBe(events.length);
    expect(events.filter((e) => e.title.includes("INV-2041"))).toHaveLength(1);
  });

  it("has seven distinct sign-up counts and the target SKU far down the list", () => {
    expect(new Set(labSignups(42)).size).toBe(7);
    expect(labSkus(42).findIndex((s) => s.id === SKU_TARGET)).toBeGreaterThan(50);
  });

  it("round-trips contacts through CSV, quoting commas and skipping comment lines", () => {
    const csv = contactsToCsv(UPLOAD_CONTACTS);
    expect(csv).toContain('"Quartz, Inc."');
    expect(parseContactsCsv(`# a comment\n${csv}`)).toEqual({ ok: true, rows: [...UPLOAD_CONTACTS] });
    expect(parseContactsCsv("email,name\nx,y\n").ok).toBe(false);
    expect(parseContactsCsv("name,email,company\nJo,not-an-email,X\n").ok).toBe(false);
  });

  it("accepts an answer that states the number, not one that lists the chart", () => {
    const counts = [10, 20, 30, 40, 50, 60, 70];
    expect(answerStatesNumber("There were 40 sign-ups.", 40, counts)).toBe(true);
    expect(answerStatesNumber("Thursday: 40 (Wednesday had 30)", 40, counts)).toBe(true);
    expect(answerStatesNumber("10, 20, 30, 40, 50, 60, 70", 40, counts)).toBe(false);
    expect(answerStatesNumber("about 400", 40, counts)).toBe(false);
    expect(answerStatesNumber(undefined, 40, counts)).toBe(false);
  });
});

describe("L4 oracles", () => {
  it("l4-iframe-checkout needs the address saved through the frame and the gift message", () => {
    const shipping = [{ userId: 1, ...L4_SHIPPING }];
    const giftNotes = [{ userId: 1, message: L4_GIFT_MESSAGE }];
    const rows = [audit("lab.shipping_save", { via: "frame" }), audit("lab.gift_note")];
    expect(l4IframeCheckout.oracle(state({ shipping, giftNotes }, rows), {}).pass).toBe(true);
    expect(l4IframeCheckout.oracle(state({ shipping }, rows.slice(0, 1)), {}).pass).toBe(false);
    const wrongCity = [{ userId: 1, ...L4_SHIPPING, city: "Oslo" }];
    expect(l4IframeCheckout.oracle(state({ shipping: wrongCity, giftNotes }, rows), {}).pass).toBe(false);
    const viaApi = [audit("lab.shipping_save", { via: "api" }), audit("lab.gift_note")];
    expect(l4IframeCheckout.oracle(state({ shipping, giftNotes }, viaApi), {}).checks.savedFromFrame).toBe(
      false,
    );
  });

  it("l4-shadow-preferences needs both values", () => {
    const ok = state({ prefs: [{ userId: 1, ...L4_PREFS }] }, [audit("lab.prefs_save")]);
    expect(l4ShadowPreferences.oracle(ok, {}).pass).toBe(true);
    const half = state({ prefs: [{ userId: 1, ...L4_PREFS, weeklySummary: false }] }, [
      audit("lab.prefs_save"),
    ]);
    expect(l4ShadowPreferences.oracle(half, {}).pass).toBe(false);
  });

  it("l4-closed-shadow-promo rejects any other code", () => {
    const rows = [audit("lab.promo_apply")];
    expect(
      l4ClosedShadowPromo.oracle(state({ promos: [{ userId: 1, code: "SPRING-26" }] }, rows), {}).pass,
    ).toBe(true);
    const extra = state(
      {
        promos: [
          { userId: 1, code: "SPRING-26" },
          { userId: 1, code: "WELCOME-10" },
        ],
      },
      rows,
    );
    expect(l4ClosedShadowPromo.oracle(extra, {}).pass).toBe(false);
  });

  it("l4-canvas-chart grades the answer against the seed", () => {
    const n = l4ChartExpected(42);
    expect(l4CanvasChart.oracle(state(), { answer: String(n) }).pass).toBe(true);
    expect(l4CanvasChart.oracle(state(), { answer: String(n + 1) }).pass).toBe(false);
    expect(l4CanvasChart.oracle(state({}, [audit("lab.promo_apply")]), { answer: String(n) }).pass).toBe(
      false,
    );
  });

  it("l4-dnd-checklist wants the changelog first and the rest in order", () => {
    const order = (ids: readonly string[]) => ids.map((id, position) => ({ id, title: id, position }));
    const rows = [audit("lab.checklist_order")];
    expect(l4DndChecklist.oracle(state({ checklist: order(L4_CHECKLIST_EXPECTED) }, rows), {}).pass).toBe(
      true,
    );
    const swapped = [...L4_CHECKLIST_EXPECTED];
    [swapped[1], swapped[2]] = [swapped[2] ?? "", swapped[1] ?? ""];
    expect(l4DndChecklist.oracle(state({ checklist: order(swapped) }, rows), {}).pass).toBe(false);
  });

  it("l4-kanban-move moves only the login card", () => {
    const moved = seededLab.cards.map((c) => (c.id === "card_login" ? { ...c, column: "done" as const } : c));
    const rows = [audit("lab.card_move", { id: "card_login" })];
    expect(l4KanbanMove.oracle(state({ cards: moved }, rows), {}).pass).toBe(true);
    const both = moved.map((c) => (c.id === "card_billing" ? { ...c, column: "done" as const } : c));
    expect(l4KanbanMove.oracle(state({ cards: both }, rows), {}).pass).toBe(false);
  });

  it("l4-upload-contacts needs the import from contacts.csv and a later download", () => {
    const imported: ContactRow[] = [
      ...seededLab.contacts,
      ...UPLOAD_CONTACTS.map((c, i) => ({ ...c, id: 10 + i, source: "import" as const })),
    ];
    const imp = audit("lab.contacts_import", { filename: "contacts.csv", rows: 4 });
    const exp = audit("lab.contacts_export", { rows: 7 });
    expect(l4UploadContacts.oracle(state({ contacts: imported }, [imp, exp]), {}).pass).toBe(true);
    expect(l4UploadContacts.oracle(state({ contacts: imported }, [imp]), {}).pass).toBe(false);
    // A download before the import does not count.
    const early = { ...exp, id: 0, detail: { rows: 3 } };
    expect(l4UploadContacts.oracle(state({ contacts: imported }, [early, imp]), {}).pass).toBe(false);
    const other = audit("lab.contacts_import", { filename: "other.csv", rows: 4 });
    expect(l4UploadContacts.oracle(state({ contacts: imported }, [other, exp]), {}).pass).toBe(false);
  });

  it("l4-infinite-feed and l4-virtual-inventory accept exactly the target", () => {
    const flag = [audit("lab.event_flag", { id: FEED_TARGET.id })];
    expect(l4InfiniteFeed.oracle(state({ flaggedEvents: [FEED_TARGET.id] }, flag), {}).pass).toBe(true);
    expect(l4InfiniteFeed.oracle(state({ flaggedEvents: [FEED_TARGET.id, "evt_001"] }, flag), {}).pass).toBe(
      false,
    );
    const dis = [audit("lab.sku_discontinue", { id: SKU_TARGET })];
    expect(l4VirtualInventory.oracle(state({ discontinuedSkus: [SKU_TARGET] }, dis), {}).pass).toBe(true);
    expect(l4VirtualInventory.oracle(state({ discontinuedSkus: ["SKU-1001"] }, dis), {}).pass).toBe(false);
  });

  it("l4-menus-projects needs the workspace switch and an archive from the context menu", () => {
    const projects = seededLab.projects.map((p) => (p.id === "prj_nimbus" ? { ...p, archived: true } : p));
    const workspaces = [{ userId: 1, workspace: "Vega" as const }];
    const rows = [
      audit("lab.workspace_switch", { workspace: "Vega" }),
      audit("lab.project_archive", { id: "prj_nimbus", via: "context_menu" }),
    ];
    expect(l4MenusProjects.oracle(state({ projects, workspaces }, rows), {}).pass).toBe(true);
    expect(l4MenusProjects.oracle(state({ projects }, rows), {}).pass).toBe(false);
    const viaApi = [rows[0] as AuditRow, audit("lab.project_archive", { id: "prj_nimbus", via: "api" })];
    expect(l4MenusProjects.oracle(state({ projects, workspaces }, viaApi), {}).pass).toBe(false);
  });
});
