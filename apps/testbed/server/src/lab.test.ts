// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 lab: seed determinism, lab routes, the frame origin, the upload fixture, and every L4 oracle (fails on a
// fresh reset, passes after the same changes made through the API).
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALICE_EMAIL,
  FEED_PAGE_SIZE,
  FEED_TARGET,
  fixtureSecrets,
  L4_CHECKLIST_EXPECTED,
  L4_GIFT_MESSAGE,
  L4_KANBAN_MOVE,
  L4_MENUS,
  L4_PREFS,
  L4_PROMO_CODE,
  L4_SHIPPING,
  l4ChartExpected,
  type OracleResult,
  parseContactsCsv,
  SESSION_COOKIE,
  SKU_TARGET,
  UPLOAD_CONTACTS,
  UPLOAD_FILE_NAME,
} from "@ghosthand/testbed-kit";
import { createAppApi } from "./app-api.ts";
import { createControlApi } from "./control-api.ts";
import { createFrameApi } from "./frame-api.ts";
import { Testbed } from "./testbed.ts";

const FIXTURE_CSV = join(import.meta.dir, "../../fixtures/uploads", UPLOAD_FILE_NAME);

let testbed: Testbed;
let app: ReturnType<typeof createAppApi>;
let control: ReturnType<typeof createControlApi>;
let frame: ReturnType<typeof createFrameApi>;
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

async function expectFail(task: string, answer?: string): Promise<void> {
  expect((await oracle(task, answer)).pass).toBe(false);
}

function postShipping(fields: Record<string, string>) {
  return frame.request("/shipping", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams(fields).toString(),
  });
}

beforeEach(async () => {
  testbed = new Testbed();
  app = createAppApi(testbed);
  control = createControlApi(testbed);
  frame = createFrameApi(testbed);
  cookie = "";
  const res = await send(app, "POST", "/api/login", {
    email: ALICE_EMAIL,
    password: fixtureSecrets.TESTBED_PASSWORD,
  });
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(res.headers.get("set-cookie") ?? "");
  cookie = `${SESSION_COOKIE}=${match?.[1] ?? ""}`;
});

describe("lab seed", () => {
  test("the same seed gives identical lab tables; another seed changes the generated ones", async () => {
    await send(control, "POST", "/reset", { seed: 7 });
    const first = await json<Record<string, unknown[]>>(control.request("/dump"));
    await send(control, "POST", "/reset", { seed: 7 });
    const second = await json<Record<string, unknown[]>>(control.request("/dump"));
    for (const t of ["lab_checklist", "lab_cards", "lab_contacts", "lab_events", "lab_skus", "lab_projects"])
      expect(second[t]).toEqual(first[t] ?? []);
    await send(control, "POST", "/reset", { seed: 8 });
    const other = await json<Record<string, unknown[]>>(control.request("/dump"));
    expect(other.lab_events).not.toEqual(first.lab_events ?? []);
    expect(other.lab_skus).not.toEqual(first.lab_skus ?? []);
  });

  test("the state snapshot carries the lab and its initial copy", async () => {
    const state = await json<{ lab: { cards: unknown[] }; initialLab: { cards: unknown[] } }>(
      control.request("/state"),
    );
    expect(state.lab.cards.length).toBe(5);
    expect(state.initialLab).toEqual(state.lab as typeof state.initialLab);
  });
});

describe("upload fixture", () => {
  test("contacts.csv parses to exactly the contacts the oracle expects", () => {
    const parsed = parseContactsCsv(readFileSync(FIXTURE_CSV, "utf8"));
    expect(parsed).toEqual({ ok: true, rows: [...UPLOAD_CONTACTS] });
  });
});

describe("lab routes", () => {
  test("signed-out requests are refused", async () => {
    cookie = "";
    expect((await send(app, "GET", "/api/lab/board")).status).toBe(401);
    expect((await send(app, "PUT", "/api/lab/prefs", L4_PREFS)).status).toBe(401);
    const html = await (await frame.request("/shipping")).text();
    expect(html).toContain("Sign in to the testbed");
  });

  test("the frame origin renders the widget and validates it", async () => {
    const res = await frame.request("/shipping", { headers: { cookie } });
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors");
    const html = await res.text();
    for (const label of ["Full name", "Street address", "Postal code", "City", "Country", "Save address"])
      expect(html).toContain(label);
    const bad = await postShipping({ fullName: "", street: "x", city: "y", postalCode: "!", country: "" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Enter the recipient&#39;s name.");
  });

  test("the feed pages through 60 events and the inventory lists 200 SKUs", async () => {
    const first = await json<{ events: { id: string }[]; next: number | null; total: number }>(
      send(app, "GET", "/api/lab/activity"),
    );
    expect(first.events).toHaveLength(FEED_PAGE_SIZE);
    expect(first.events.some((e) => e.id === FEED_TARGET.id)).toBe(false);
    expect(first.next).toBe(FEED_PAGE_SIZE);
    const last = await json<{ next: number | null }>(send(app, "GET", "/api/lab/activity?cursor=48"));
    expect(last.next).toBeNull();
    const inv = await json<{ skus: { id: string }[] }>(send(app, "GET", "/api/lab/inventory"));
    expect(inv.skus).toHaveLength(200);
  });

  test("a bad checklist order and an unknown promo code are rejected", async () => {
    expect((await send(app, "PUT", "/api/lab/checklist", { order: ["chk_tag"] })).status).toBe(400);
    expect((await send(app, "POST", "/api/lab/promo", { code: "NOPE" })).status).toBe(400);
    expect(
      (await send(app, "POST", "/api/lab/contacts/import", { filename: "x.csv", csv: "a,b\n" })).status,
    ).toBe(400);
  });

  test("the contacts download is a CSV attachment and is audited", async () => {
    const res = await send(app, "GET", "/api/lab/contacts/export.csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect((await res.text()).split("\n")[0]).toBe("name,email,company");
    const state = await json<{ audit: { action: string; detail: { rows?: number } }[] }>(
      control.request("/state"),
    );
    expect(state.audit.some((r) => r.action === "lab.contacts_export" && r.detail.rows === 3)).toBe(true);
  });
});

describe("L4 oracles", () => {
  test("l4-iframe-checkout", async () => {
    await expectFail("l4-iframe-checkout");
    expect((await postShipping({ ...L4_SHIPPING })).status).toBe(200);
    await expectFail("l4-iframe-checkout");
    expect((await send(app, "PUT", "/api/lab/gift-note", { message: L4_GIFT_MESSAGE })).status).toBe(200);
    await expectPass("l4-iframe-checkout");
  });

  test("l4-shadow-preferences", async () => {
    await expectFail("l4-shadow-preferences");
    expect((await send(app, "PUT", "/api/lab/prefs", { ...L4_PREFS, weeklySummary: false })).status).toBe(
      200,
    );
    await expectFail("l4-shadow-preferences");
    await send(app, "PUT", "/api/lab/prefs", L4_PREFS);
    await expectPass("l4-shadow-preferences");
  });

  test("l4-closed-shadow-promo", async () => {
    await expectFail("l4-closed-shadow-promo");
    expect((await send(app, "POST", "/api/lab/promo", { code: L4_PROMO_CODE.toLowerCase() })).status).toBe(
      200,
    );
    await expectPass("l4-closed-shadow-promo");
    await send(app, "POST", "/api/lab/promo", { code: "WELCOME-10" });
    await expectFail("l4-closed-shadow-promo");
  });

  test("l4-canvas-chart", async () => {
    const n = l4ChartExpected(42);
    const counts = (await json<{ counts: number[] }>(send(app, "GET", "/api/lab/signups"))).counts;
    expect(counts[3]).toBe(n);
    await expectFail("l4-canvas-chart");
    await expectFail("l4-canvas-chart", String(n + 1));
    await expectFail("l4-canvas-chart", counts.join(", "));
    await expectPass("l4-canvas-chart", `There were ${n} sign-ups on Thursday.`);
  });

  test("l4-canvas-target", async () => {
    await expectFail("l4-canvas-target");
    // A miss is rejected and does not count as a click on a shape.
    expect((await send(app, "POST", "/api/lab/canvas-target", { shape: "nothing" })).status).toBe(400);
    await expectFail("l4-canvas-target");
    expect((await send(app, "POST", "/api/lab/canvas-target", { shape: "red circle" })).status).toBe(200);
    await expectPass("l4-canvas-target");
    // Any other shape afterwards fails the task.
    expect((await send(app, "POST", "/api/lab/canvas-target", { shape: "blue square" })).status).toBe(200);
    await expectFail("l4-canvas-target");
  });

  test("l6-icon-toolbar", async () => {
    await expectFail("l6-icon-toolbar");
    expect((await send(app, "POST", "/api/lab/toolbar", { pane: "nope" })).status).toBe(400);
    expect((await send(app, "POST", "/api/lab/toolbar", { pane: "filters" })).status).toBe(200);
    await expectPass("l6-icon-toolbar");
    await send(app, "POST", "/api/lab/toolbar", { pane: "export" });
    await expectFail("l6-icon-toolbar");
  });

  test("l4-dnd-checklist", async () => {
    await expectFail("l4-dnd-checklist");
    const res = await send(app, "PUT", "/api/lab/checklist", { order: L4_CHECKLIST_EXPECTED });
    expect(res.status).toBe(200);
    await expectPass("l4-dnd-checklist");
  });

  test("l4-kanban-move", async () => {
    await expectFail("l4-kanban-move");
    const res = await send(app, "PATCH", `/api/lab/board/cards/${L4_KANBAN_MOVE.cardId}`, {
      column: "done",
      position: 0,
    });
    expect(res.status).toBe(200);
    await expectPass("l4-kanban-move");
    await send(app, "PATCH", "/api/lab/board/cards/card_billing", { column: "done", position: 0 });
    await expectFail("l4-kanban-move");
  });

  test("l4-upload-contacts", async () => {
    await expectFail("l4-upload-contacts");
    const csv = readFileSync(FIXTURE_CSV, "utf8");
    const res = await send(app, "POST", "/api/lab/contacts/import", { filename: UPLOAD_FILE_NAME, csv });
    expect(res.status).toBe(200);
    await expectFail("l4-upload-contacts");
    await send(app, "GET", "/api/lab/contacts/export.csv");
    await expectPass("l4-upload-contacts");
  });

  test("l4-infinite-feed", async () => {
    await expectFail("l4-infinite-feed");
    expect((await send(app, "POST", `/api/lab/activity/${FEED_TARGET.id}/flag`)).status).toBe(200);
    await expectPass("l4-infinite-feed");
  });

  test("l4-virtual-inventory", async () => {
    await expectFail("l4-virtual-inventory");
    expect((await send(app, "POST", `/api/lab/inventory/${SKU_TARGET}/discontinue`)).status).toBe(200);
    await expectPass("l4-virtual-inventory");
  });

  test("l4-menus-projects", async () => {
    await expectFail("l4-menus-projects");
    const listed = await json<{ projects: { id: string }[] }>(send(app, "GET", "/api/lab/projects"));
    expect(listed.projects.some((p) => p.id === L4_MENUS.projectId)).toBe(false);
    await send(app, "POST", "/api/lab/workspace", { workspace: L4_MENUS.workspace });
    await send(app, "POST", `/api/lab/projects/${L4_MENUS.projectId}/archive`, { via: "context_menu" });
    await expectPass("l4-menus-projects");
  });
});
