// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 hard DOM: performs each task like a person and checks the oracle fails before and passes after.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FEED_TARGET,
  L4_CHECKLIST_EXPECTED,
  L4_CHECKLIST_MOVE,
  L4_GIFT_MESSAGE,
  L4_KANBAN_MOVE,
  L4_MENUS,
  L4_PREFS,
  L4_PROMO_CODE,
  L4_SHIPPING,
  LAB_MESSAGES,
  l4CanvasChart,
  l4ChartExpected,
  l4ClosedShadowPromo,
  l4DndChecklist,
  l4IframeCheckout,
  l4InfiniteFeed,
  l4KanbanMove,
  l4MenusProjects,
  l4ShadowPreferences,
  l4UploadContacts,
  l4VirtualInventory,
  SKU_TARGET,
  UPLOAD_CONTACTS,
  UPLOAD_FILE_NAME,
} from "@ghosthand/testbed-kit";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectOracleFails, expectOraclePasses, prepare } from "./control.ts";

const UPLOADS = join(import.meta.dirname, "../../fixtures/uploads");

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("l4-iframe-checkout: fill a cross-origin frame and a same-origin frame", async ({ page, context }) => {
  await prepare(l4IframeCheckout, context, page);
  await expectOracleFails(l4IframeCheckout.id);

  const shipping = page.frameLocator('iframe[title="Shipping address"]');
  await shipping.getByLabel("Full name").fill(L4_SHIPPING.fullName);
  await shipping.getByLabel("Street address").fill(L4_SHIPPING.street);
  await shipping.getByLabel("Postal code").fill(L4_SHIPPING.postalCode);
  await shipping.getByLabel("City").fill(L4_SHIPPING.city);
  await shipping.getByLabel("Country").selectOption(L4_SHIPPING.country);
  await shipping.getByRole("button", { name: "Save address" }).click();
  await expect(shipping.getByRole("status")).toHaveText(LAB_MESSAGES.shippingSaved);
  // The frame tells the page; the summary outside the frame updates.
  await expect(page.getByText(`Ships to ${L4_SHIPPING.fullName}`)).toBeVisible();

  const gift = page.frameLocator('iframe[title="Gift message"]');
  await gift.getByLabel("Gift message").fill(L4_GIFT_MESSAGE);
  await gift.getByRole("button", { name: "Save message" }).click();
  await expect(gift.getByRole("status").filter({ hasText: LAB_MESSAGES.giftSaved })).toBeVisible();

  await expectOraclePasses(l4IframeCheckout.id);
});

test("l4-shadow-preferences: use a form inside an open shadow root", async ({ page, context }) => {
  await prepare(l4ShadowPreferences, context, page);
  await expectOracleFails(l4ShadowPreferences.id);

  // Playwright's role and label locators pierce open shadow roots, as the driver's aria snapshot does.
  const digest = page.getByLabel("Send digest at");
  await expect(digest).toHaveValue("08:00");
  await digest.selectOption(L4_PREFS.digestAt);
  await page.getByRole("checkbox", { name: "Weekly summary" }).check();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("status").filter({ hasText: LAB_MESSAGES.prefsSaved })).toBeVisible();
  expect(await page.evaluate(() => document.querySelector("gh-notify-prefs")?.shadowRoot !== null)).toBe(
    true,
  );

  await expectOraclePasses(l4ShadowPreferences.id);
});

test("l4-closed-shadow-promo: reach a closed shadow root by pointer and keyboard only", async ({
  page,
  context,
}) => {
  await prepare(l4ClosedShadowPromo, context, page);
  await expectOracleFails(l4ClosedShadowPromo.id);

  const host = page.locator("gh-promo-box");
  await expect(host).toBeVisible();
  // Nothing inside is reachable from the DOM: no shadowRoot, no accessible controls for locators.
  expect(await host.evaluate((el) => el.shadowRoot)).toBeNull();
  await expect(page.getByRole("button", { name: "Apply code" })).toHaveCount(0);
  await expect(page.getByText("No promo code applied yet.")).toBeVisible();

  // Like a vision agent: click where the field is drawn (left side of the box, below its label), type, Enter.
  const box = await host.boundingBox();
  if (!box) throw new Error("promo box has no box");
  await page.mouse.click(box.x + 60, box.y + 50);
  expect(await page.evaluate(() => document.activeElement?.localName)).toBe("gh-promo-box");
  await page.keyboard.type(L4_PROMO_CODE);
  await page.keyboard.press("Enter");
  await expect(page.getByText(`Applied codes: ${L4_PROMO_CODE}`)).toBeVisible();

  await expectOraclePasses(l4ClosedShadowPromo.id);
});

test("l4-canvas-chart: the value is drawn, not written", async ({ page, context }) => {
  await prepare(l4CanvasChart, context, page);
  const expected = l4ChartExpected(l4CanvasChart.setup.seed);
  const canvas = page.getByRole("img", { name: /Bar chart of sign-ups/ });
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((el) => {
        const c = el as HTMLCanvasElement;
        const data = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data ?? [];
        let painted = 0;
        for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) painted++;
        return painted;
      }),
    )
    .toBeGreaterThan(1000);
  // The number is not in the accessibility tree of the page.
  expect(await page.locator("main").ariaSnapshot()).not.toContain(String(expected));

  await expectOracleFails(l4CanvasChart.id);
  await expectOracleFails(l4CanvasChart.id, String(expected + 1));
  await expectOraclePasses(l4CanvasChart.id, `Thursday had ${expected} sign-ups.`);
});

test("l4-dnd-checklist: reorder with HTML5 drag and drop", async ({ page, context }) => {
  await prepare(l4DndChecklist, context, page);
  await expectOracleFails(l4DndChecklist.id);

  const list = page.getByRole("list", { name: "Release checklist" });
  const item = list.getByRole("listitem").filter({ hasText: L4_CHECKLIST_MOVE.item });
  const onto = list.getByRole("listitem").filter({ hasText: L4_CHECKLIST_MOVE.onto });
  await expect(item).toHaveAttribute("draggable", "true");
  await expect(onto).toHaveAttribute("aria-dropeffect", "move");
  await item.dragTo(onto);
  await expect(page.getByText(LAB_MESSAGES.checklistSaved)).toBeVisible();
  await expect(list.getByRole("listitem").first()).toHaveText(L4_CHECKLIST_MOVE.item);
  expect(L4_CHECKLIST_EXPECTED[0]).toBe("chk_changelog");

  await expectOraclePasses(l4DndChecklist.id);
});

test("l4-kanban-move: drag a card with pointer events to another column", async ({ page, context }) => {
  await prepare(l4KanbanMove, context, page);
  await expectOracleFails(l4KanbanMove.id);

  const card = page.getByRole("listitem").filter({ hasText: L4_KANBAN_MOVE.title });
  const done = page.getByRole("list", { name: "Done" });
  await expect(card).toHaveAttribute("aria-roledescription", "draggable card");
  await expect(done).toHaveAttribute("aria-dropeffect", "move");
  const from = await center(card);
  const to = await center(done);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText(LAB_MESSAGES.cardMoved(L4_KANBAN_MOVE.title, "Done"))).toBeVisible();
  await expect(done.getByRole("listitem").filter({ hasText: L4_KANBAN_MOVE.title })).toBeVisible();

  await expectOraclePasses(l4KanbanMove.id);
});

test("l4-upload-contacts: upload a CSV, then download the export", async ({ page, context }) => {
  await prepare(l4UploadContacts, context, page);
  await expectOracleFails(l4UploadContacts.id);

  await page.getByLabel("Contacts CSV file").setInputFiles(join(UPLOADS, UPLOAD_FILE_NAME));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText(LAB_MESSAGES.imported(UPLOAD_CONTACTS.length))).toBeVisible();
  await expect(page.getByRole("cell", { name: "Quartz, Inc." })).toBeVisible();
  await expectOracleFails(l4UploadContacts.id);

  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download CSV" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("contacts-export.csv");
  const path = await download.path();
  const csv = readFileSync(path, "utf8");
  expect(csv).toContain('elena@quartz.example,"Quartz, Inc."');

  await expectOraclePasses(l4UploadContacts.id);
});

test("l4-infinite-feed: scroll until older events load, then flag one", async ({ page, context }) => {
  await prepare(l4InfiniteFeed, context, page);
  await expectOracleFails(l4InfiniteFeed.id);

  const feed = page.getByRole("feed", { name: "Activity" });
  await expect(feed.getByRole("article")).toHaveCount(12);
  const flag = page.getByRole("button", { name: `Flag: ${FEED_TARGET.title}` });
  await expect(flag).toHaveCount(0);
  await page.mouse.move(400, 400);
  for (let i = 0; i < 30 && (await flag.count()) === 0; i++) {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(250);
  }
  await flag.click();
  await expect(page.getByText(LAB_MESSAGES.flagged(FEED_TARGET.title))).toBeVisible();

  await expectOraclePasses(l4InfiniteFeed.id);
});

test("l4-virtual-inventory: scroll a virtualized list to a row that is not rendered", async ({
  page,
  context,
}) => {
  await prepare(l4VirtualInventory, context, page);
  await expectOracleFails(l4VirtualInventory.id);

  const list = page.getByRole("list", { name: "Inventory" });
  await expect(list.getByRole("listitem").first()).toHaveAttribute("aria-setsize", "200");
  const rendered = await list.getByRole("listitem").count();
  expect(rendered).toBeLessThan(20);
  const button = page.getByRole("button", { name: `Discontinue ${SKU_TARGET}` });
  await expect(button).toHaveCount(0);
  const at = await center(list);
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 30 && !(await button.isVisible()); i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(100);
  }
  await button.click();
  await expect(page.getByText(LAB_MESSAGES.discontinued(SKU_TARGET))).toBeVisible();

  await expectOraclePasses(l4VirtualInventory.id);
});

async function projectRow(page: Page, name: string): Promise<Locator> {
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name, exact: true }) });
  await expect(row).toHaveAttribute("aria-haspopup", "menu");
  return row;
}

test("l4-menus-projects: a hover menu and a row context menu", async ({ page, context }) => {
  await prepare(l4MenusProjects, context, page);
  await expectOracleFails(l4MenusProjects.id);

  const trigger = page.getByRole("button", { name: /^Workspace: / });
  const menu = page.getByRole("menu", { name: "Workspace" });
  await expect(trigger).toHaveText("Workspace: Atlas");
  await trigger.hover();
  await expect(menu).toBeVisible();
  // Clicking the trigger of an open hover menu keeps it open.
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await menu.getByRole("menuitemradio", { name: L4_MENUS.workspace }).click();
  await expect(trigger).toHaveText(`Workspace: ${L4_MENUS.workspace}`);

  // Keyboard path: Shift+F10 on a focused row opens its menu, Escape closes it again.
  const orion = await projectRow(page, "Orion");
  await orion.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: "Actions for Orion" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Actions for Orion" })).toBeHidden();
  await expect(orion).toBeFocused();

  const nimbus = await projectRow(page, L4_MENUS.project);
  await nimbus.click({ button: "right" });
  await expect(nimbus).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("menu", { name: `Actions for ${L4_MENUS.project}` })
    .getByRole("menuitem", { name: "Archive project" })
    .click();
  await expect(page.getByText(LAB_MESSAGES.archived(L4_MENUS.project))).toBeVisible();
  await expect(page.getByRole("cell", { name: L4_MENUS.project, exact: true })).toHaveCount(0);

  await expectOraclePasses(l4MenusProjects.id);
});
