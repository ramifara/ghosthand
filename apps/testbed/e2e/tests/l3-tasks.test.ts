// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L3 rich widgets: performs each task like a person and checks the oracle fails before and passes after.
import {
  L3_BIO_BOLD_WORD,
  L3_COMBOBOX_CUSTOMER,
  L3_EMAIL_LIMIT,
  L3_REPORT_RANGE,
  L3_TAGS_TO_ADD,
  l3AccordionTooltip,
  l3AssignCustomerCombobox,
  l3DateRangeReport,
  l3RichTextBio,
  l3SettingsTabsSlider,
  l3TagsMultiselect,
  ORDER_ANCHORS,
  SETTINGS_MESSAGES,
} from "@ghosthand/testbed-kit";
import { expect, type Page, test } from "@playwright/test";
import { control, expectOracleFails, expectOraclePasses, orderRow, prepare, unwrap } from "./control.ts";

test("l3-assign-customer-combobox: type, wait for async options, pick one", async ({ page, context }) => {
  const id = ORDER_ANCHORS.combobox.id;
  await prepare(l3AssignCustomerCombobox, context, page);
  await expectOracleFails(l3AssignCustomerCombobox.id);

  await page.getByLabel("Search orders").fill(id);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Showing 1–1 of 1 order")).toBeVisible();
  await orderRow(page, id).getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Edit order ${id}` });
  const combobox = dialog.getByRole("combobox", { name: "Customer" });
  await expect(combobox).toHaveValue(ORDER_ANCHORS.combobox.customer);
  await combobox.fill("Mira");
  await expect(combobox).toHaveAttribute("aria-expanded", "true");
  const options = dialog.getByRole("listbox", { name: "Customers" }).getByRole("option");
  await expect(options).toHaveCount(3);
  await dialog.getByRole("option", { name: new RegExp(`^${L3_COMBOBOX_CUSTOMER}`) }).click();
  await expect(combobox).toHaveValue(L3_COMBOBOX_CUSTOMER);
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(dialog).toBeHidden();
  await expect(orderRow(page, id)).toContainText(L3_COMBOBOX_CUSTOMER);
  await expectOraclePasses(l3AssignCustomerCombobox.id);
});

test("l3-tags-multiselect: add two tags, keep the existing one", async ({ page, context }) => {
  const id = ORDER_ANCHORS.tags.id;
  await prepare(l3TagsMultiselect, context, page);
  await expectOracleFails(l3TagsMultiselect.id);

  await page.getByRole("navigation", { name: "Pagination" }).getByRole("button", { name: "Page 2" }).click();
  await orderRow(page, id).getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Edit order ${id}` });
  await dialog.getByRole("button", { name: /^Tags/ }).click();
  const listbox = dialog.getByRole("listbox", { name: "Tags" });
  await expect(listbox).toHaveAttribute("aria-multiselectable", "true");
  await expect(listbox.getByRole("option", { name: "gift" })).toHaveAttribute("aria-selected", "true");
  for (const tag of L3_TAGS_TO_ADD) {
    await listbox.getByRole("option", { name: tag }).click();
    await expect(listbox.getByRole("option", { name: tag })).toHaveAttribute("aria-selected", "true");
  }
  // Escape closes the listbox, not the dialog.
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  await expect(dialog).toBeVisible();
  const chips = dialog.getByRole("list", { name: "Selected tags" });
  for (const tag of ["gift", ...L3_TAGS_TO_ADD]) {
    await expect(chips.getByRole("button", { name: `Remove tag ${tag}` })).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(dialog).toBeHidden();
  await expectOraclePasses(l3TagsMultiselect.id);
});

async function pickDate(page: Page, label: string, longLabel: string, monthsBack: number): Promise<void> {
  await page.getByRole("button", { name: `Choose ${label} date` }).click();
  const calendar = page.getByRole("dialog", { name: `${label} calendar` });
  // The calendar opens on the testbed clock's month (March 2026), the same in every run.
  await expect(calendar.getByRole("heading", { name: "March 2026" })).toBeVisible();
  for (let i = 0; i < monthsBack; i++) await calendar.getByRole("button", { name: "Previous month" }).click();
  await expect(calendar.getByRole("grid", { name: "January 2026" })).toBeVisible();
  await calendar.getByRole("button", { name: longLabel }).click();
  await expect(calendar).toBeHidden();
}

test("l3-date-range-report: pick a range in two calendars and read the total", async ({ page, context }) => {
  await prepare(l3DateRangeReport, context, page);

  await pickDate(page, "From", "Monday, January 12, 2026", 2);
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(L3_REPORT_RANGE.from);
  await pickDate(page, "To", "Sunday, January 25, 2026", 2);
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(L3_REPORT_RANGE.to);
  await page.getByRole("button", { name: "Run report" }).click();

  const result = page.getByRole("region", {
    name: `Revenue from ${L3_REPORT_RANGE.from} to ${L3_REPORT_RANGE.to}`,
  });
  await expect(result).toBeVisible();
  const total = (await result.getByRole("definition").first().textContent()) ?? "";
  expect(total).toMatch(/^\$[\d,]+\.\d{2}$/);
  await expectOracleFails(l3DateRangeReport.id, "$0.00");
  await expectOraclePasses(l3DateRangeReport.id, `Total revenue: ${total}`);
});

test("l3-settings-tabs-slider: switch tab, move the slider with the keyboard, save", async ({
  page,
  context,
}) => {
  await prepare(l3SettingsTabsSlider, context, page);
  await expectOracleFails(l3SettingsTabsSlider.id);

  await page.getByRole("tab", { name: "Notifications" }).click();
  await expect(page.getByRole("tab", { name: "Notifications" })).toHaveAttribute("aria-selected", "true");
  const slider = page.getByRole("slider", { name: "Daily email limit" });
  await expect(slider).toHaveAttribute("aria-valuenow", "20");
  await slider.focus();
  for (let v = 20; v < L3_EMAIL_LIMIT; v += 5) await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", String(L3_EMAIL_LIMIT));
  await expect(page.getByText(`${L3_EMAIL_LIMIT} emails`)).toBeVisible();
  await page.getByRole("button", { name: "Save notification settings" }).click();

  await expect(page.getByRole("status").filter({ hasText: SETTINGS_MESSAGES.notifications })).toBeVisible();
  await expectOraclePasses(l3SettingsTabsSlider.id);
});

test("l3-rich-text-bio: select a word, make it bold, save", async ({ page, context }) => {
  await prepare(l3RichTextBio, context, page);
  await expectOracleFails(l3RichTextBio.id);

  const editor = page.getByRole("textbox", { name: "Bio" });
  await expect(editor).toContainText("I build test fixtures");
  // Select the word the way a double-click would.
  await editor.evaluate((el, word) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(word) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
  }, L3_BIO_BOLD_WORD);
  const bold = page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Bold" });
  await bold.click();
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await expect(editor.locator("b, strong")).toHaveText(L3_BIO_BOLD_WORD);
  await page.getByRole("button", { name: "Save bio" }).click();

  await expect(page.getByRole("status").filter({ hasText: SETTINGS_MESSAGES.bioSaved })).toBeVisible();
  await expectOraclePasses(l3RichTextBio.id);
});

test("l3-accordion-tooltip: open a tab and an accordion, find the icon button by its tooltip", async ({
  page,
  context,
}) => {
  await prepare(l3AccordionTooltip, context, page);
  await expectOracleFails(l3AccordionTooltip.id);

  await page.getByRole("tab", { name: "Advanced" }).click();
  const rotate = page.getByRole("button", { name: "Rotate webhook secret" });
  await expect(rotate).toHaveCount(0);
  const developer = page.getByRole("button", { name: "Developer" });
  await expect(developer).toHaveAttribute("aria-expanded", "false");
  await developer.click();
  await expect(developer).toHaveAttribute("aria-expanded", "true");

  await rotate.hover();
  await expect(page.getByRole("tooltip", { name: "Rotate webhook secret" })).toBeVisible();
  await rotate.click();

  await expect(page.getByText("Webhook secret version 2")).toBeVisible();
  await expectOraclePasses(l3AccordionTooltip.id);
  const alice = unwrap(await control.state()).settings[0];
  expect(alice?.apiKeyRevoked).toBe(false);
});

test("testids variant covers the L2/L3 pages", async ({ page, context }) => {
  const prepared = unwrap(await control.reset({ seed: 42, variant: { testids: "on" } }));
  expect(prepared.variant.testids).toBe("on");
  const session = unwrap(await control.createSession("alice@testbed.local"));
  await context.addCookies([
    { ...session.cookie, url: "http://127.0.0.1:4400", httpOnly: true, sameSite: "Lax" },
  ]);
  await page.goto("/orders");
  await expect(page.getByTestId("orders.table")).toBeVisible();
  await expect(page.getByTestId("orders.row.ord_1001")).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByTestId("settings.tab.notifications")).toBeVisible();

  unwrap(await control.reset({ seed: 42 }));
  const again = unwrap(await control.createSession("alice@testbed.local"));
  await context.addCookies([
    { ...again.cookie, url: "http://127.0.0.1:4400", httpOnly: true, sameSite: "Lax" },
  ]);
  await page.goto("/orders");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.locator("[data-testid]")).toHaveCount(0);
});
