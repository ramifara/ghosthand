// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L6 robustness variants: performs each task like a person under its variant and checks the oracle fails
// before and passes after.
import {
  ALICE_EMAIL,
  APP_ORIGIN,
  COOKIE_BANNER,
  L6_DYNAMIC_PHONE,
  L6_EMAIL_LIMIT,
  L6_POOR_A11Y_PHONE,
  L6_POPUPS_TITLE,
  l6DarkZoomSettings,
  l6DynamicIds,
  l6FlakyPreferences,
  l6IconToggleVision,
  l6LayoutShift,
  l6PoorA11y,
  l6PopupsProfile,
  l6RtlLocale,
  PREFERENCES_STRINGS,
  PROFILE_SAVED_MESSAGE,
  PROMO_DISMISS,
  SETTINGS_MESSAGES,
} from "@ghosthand/testbed-kit";
import { expect, type Page, test } from "@playwright/test";
import { control, expectOracleFails, expectOraclePasses, prepare, unwrap } from "./control.ts";

const en = PREFERENCES_STRINGS.en;
const ar = PREFERENCES_STRINGS.ar;

function savedNotice(page: Page, text: string = en.saved) {
  return page.getByRole("status").filter({ hasText: text });
}

test("l6-flaky-preferences: retry the failed load, wait out slow saves", async ({ page, context }) => {
  await prepare(l6FlakyPreferences, context, page);
  await expectOracleFails(l6FlakyPreferences.id);

  await expect(page.getByText(en.loadFailed)).toBeVisible({ timeout: 6000 });
  await page.getByRole("button", { name: en.retry }).click();
  const sms = page.getByRole("radio", { name: en.methods.sms });
  await expect(sms).toBeVisible({ timeout: 6000 });
  await sms.check();
  await page.getByRole("button", { name: en.save }).click();
  await expect(page.getByRole("button", { name: en.saving })).toBeDisabled();
  await expect(savedNotice(page)).toBeVisible({ timeout: 6000 });
  await expectOraclePasses(l6FlakyPreferences.id);
});

test("l6-popups-profile: close the promo, reject cookies, save the profile", async ({ page, context }) => {
  await prepare(l6PopupsProfile, context, page);
  await expectOracleFails(l6PopupsProfile.id);

  const banner = page.getByRole("region", { name: COOKIE_BANNER.title });
  await expect(banner).toBeVisible();
  const promo = page.getByRole("dialog");
  await expect(promo).toBeVisible({ timeout: 4000 });
  // The modal blocks the page until it is closed.
  await expect(page.getByRole("textbox", { name: "Job title" })).toHaveCount(0);
  await promo.getByRole("button", { name: PROMO_DISMISS }).click();
  await expect(promo).toBeHidden();
  await banner.getByRole("button", { name: COOKIE_BANNER.reject }).click();
  await expect(banner).toBeHidden();

  await page.getByLabel("Job title").fill(L6_POPUPS_TITLE);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: PROFILE_SAVED_MESSAGE })).toBeVisible();
  await expectOraclePasses(l6PopupsProfile.id);

  // Both stay gone on the next page load.
  await page.reload();
  await expect(page.getByLabel("Job title")).toHaveValue(L6_POPUPS_TITLE);
  await page.waitForTimeout(2000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(banner).toHaveCount(0);
});

test("l6-layout-shift: the save button moves after the first change", async ({ page, context }) => {
  await prepare(l6LayoutShift, context, page);
  await expectOracleFails(l6LayoutShift.id);

  const save = page.getByRole("button", { name: en.save });
  const before = await save.boundingBox();
  await page.getByRole("checkbox", { name: en.news }).uncheck();
  const unsubscribe = page.getByRole("button", { name: en.unsubscribe });
  await expect(unsubscribe).toBeVisible();
  const after = await save.boundingBox();
  const hazard = await unsubscribe.boundingBox();
  expect(after?.y ?? 0).toBeGreaterThan((before?.y ?? 0) + 40);
  // The unsubscribe button now sits about where Save was.
  expect(Math.abs((hazard?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(24);

  await save.click();
  await expect(savedNotice(page)).toBeVisible();
  await expectOraclePasses(l6LayoutShift.id);
});

test("l6-dynamic-ids: ids and classes change on every render", async ({ page, context }) => {
  await prepare(l6DynamicIds, context, page);
  await expectOracleFails(l6DynamicIds.id);

  const phone = page.getByLabel(en.phone);
  const firstId = await phone.getAttribute("id");
  await phone.fill(L6_DYNAMIC_PHONE);
  await expect(phone).not.toHaveAttribute("id", firstId ?? "");
  await expect(page.locator("[data-testid]")).toHaveCount(0);
  await page.getByRole("button", { name: en.save }).click();
  await expect(savedNotice(page)).toBeVisible();
  await expectOraclePasses(l6DynamicIds.id);
});

test("l6-poor-a11y: placeholder-only input, div radios, div button", async ({ page, context }) => {
  await prepare(l6PoorA11y, context, page);
  await expectOracleFails(l6PoorA11y.id);

  // No labels, roles or states: only the placeholder names the input.
  await expect(page.getByText(en.phone, { exact: true })).toBeVisible();
  await expect(page.getByLabel(en.phone)).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.save })).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  await page.getByPlaceholder(en.phone).fill(L6_POOR_A11Y_PHONE);
  await page.getByText(en.methods.phone, { exact: true }).click();
  await page.getByText(en.save, { exact: true }).click();
  await expect(savedNotice(page)).toBeVisible();
  await expectOraclePasses(l6PoorA11y.id);
});

test("l6-icon-toggle-vision: an unnamed icon-only toggle", async ({ page, context }) => {
  await prepare(l6IconToggleVision, context, page);
  await expectOracleFails(l6IconToggleVision.id);

  const bell = page.locator(".pref-item").filter({ hasText: en.news }).getByRole("button");
  await expect(bell).toHaveAccessibleName("");
  await expect(bell).not.toHaveAttribute("aria-pressed", /.*/);
  await bell.click();
  await expect(bell.locator("svg.lucide-bell-off")).toHaveCount(1);
  await page.getByText(en.save, { exact: true }).click();
  await expect(savedNotice(page)).toBeVisible();
  await expectOraclePasses(l6IconToggleVision.id);
});

test("l6-rtl-locale: Arabic labels, right-to-left layout", async ({ page, context }) => {
  await prepare(l6RtlLocale, context, page);
  await expectOracleFails(l6RtlLocale.id);

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: ar.title })).toBeVisible();
  await page.getByRole("radio", { name: ar.methods.sms }).check();
  await page.getByRole("checkbox", { name: ar.news }).uncheck();
  await page.getByRole("button", { name: ar.save }).click();
  await expect(savedNotice(page, ar.saved)).toBeVisible();
  await expectOraclePasses(l6RtlLocale.id);
});

test("l6-dark-zoom-settings: the L3 slider flow in dark mode at 150%", async ({ page, context }) => {
  await prepare(l6DarkZoomSettings, context, page);
  await expectOracleFails(l6DarkZoomSettings.id);

  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("data-zoom", "150");
  expect(await html.evaluate((el) => getComputedStyle(el).fontSize)).toBe("24px");
  expect(await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgb(18, 20, 22)",
  );

  await page.getByRole("tab", { name: "Notifications" }).click();
  const slider = page.getByRole("slider", { name: "Daily email limit" });
  await slider.focus();
  for (let v = 20; v < L6_EMAIL_LIMIT; v += 5) await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", String(L6_EMAIL_LIMIT));
  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: SETTINGS_MESSAGES.notifications })).toBeVisible();
  await expectOraclePasses(l6DarkZoomSettings.id);
});

test("L6 flags are off by default: no banner, no shift, stable ids, light-or-device theme", async ({
  page,
  context,
}) => {
  unwrap(await control.reset({ seed: 42 }));
  const cookie = unwrap(await control.createSession(ALICE_EMAIL)).cookie;
  await context.addCookies([{ ...cookie, url: APP_ORIGIN, httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/preferences");
  await expect(page.getByLabel(en.phone)).toHaveAttribute("id", "prefs-phone");
  await page.getByRole("checkbox", { name: en.news }).uncheck();
  await page.waitForTimeout(1000);
  await expect(page.getByRole("button", { name: en.unsubscribe })).toHaveCount(0);
  await expect(page.getByRole("region", { name: COOKIE_BANNER.title })).toHaveCount(0);
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
  await expect(html).not.toHaveAttribute("dir", /.+/);
});
