// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Performs every testbed task the way a person would, and checks the oracle fails before and passes after.
import {
  ALICE_EMAIL,
  APP_ORIGIN,
  type ControlClient,
  createControlClient,
  fixtureSecrets,
  HANDLE_TAKEN_MESSAGE,
  L1_FORM_VALIDATION_HANDLES,
  L1_UPDATE_PROFILE_TARGET,
  LOGIN_ERROR_MESSAGE,
  l1FormValidation,
  l1Login,
  l1LoginWrongPassword,
  l1UpdateProfile,
  type OracleResult,
  PROFILE_SAVED_MESSAGE,
  type TestbedTask,
} from "@ghosthand/testbed-kit";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const control: ControlClient = createControlClient();

function unwrap<T>(res: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!res.ok) throw new Error(`control API call failed: ${JSON.stringify(res.error)}`);
  return res.value;
}

async function oracle(taskId: string, answer?: string): Promise<OracleResult> {
  return unwrap(await control.oracle(taskId, answer === undefined ? {} : { answer }));
}

/** Resets the testbed for a task and, when the task starts signed in, hands the session cookie to the browser. */
async function prepare(task: TestbedTask, context: BrowserContext, page: Page): Promise<void> {
  const prepared = unwrap(await control.prepare(task));
  if (prepared.cookie) {
    await context.addCookies([{ ...prepared.cookie, url: APP_ORIGIN, httpOnly: true, sameSite: "Lax" }]);
  }
  await page.goto(task.start);
}

test("L0 home: static text, a seeded value and a link", async ({ page }) => {
  unwrap(await control.reset({ seed: 42 }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to the testbed" })).toBeVisible();
  const buildCode = page.getByRole("definition").first();
  await expect(buildCode).toHaveText(/^GH-\d{4}$/);
  const first = await buildCode.textContent();

  unwrap(await control.reset({ seed: 42 }));
  await page.reload();
  await expect(page.getByRole("definition").first()).toHaveText(first ?? "");

  await page.getByRole("link", { name: "Sign in to your account" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("l1-login: sign in with the right password", async ({ page, context }) => {
  await prepare(l1Login, context, page);
  expect((await oracle(l1Login.id)).pass).toBe(false);

  await page.getByLabel("Email").fill(ALICE_EMAIL);
  await page.getByLabel("Password").fill(fixtureSecrets.TESTBED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText(`Signed in as ${ALICE_EMAIL}`)).toBeVisible();
  await expect(page).toHaveURL(`${APP_ORIGIN}/`);
  const result = await oracle(l1Login.id);
  expect(result, JSON.stringify(result.checks)).toMatchObject({ pass: true });
});

test("l1-login-wrong-password: the error is shown and no session is created", async ({ page, context }) => {
  await prepare(l1LoginWrongPassword, context, page);
  expect((await oracle(l1LoginWrongPassword.id, LOGIN_ERROR_MESSAGE)).pass).toBe(false);

  await page.getByLabel("Email").fill(ALICE_EMAIL);
  await page.getByLabel("Password").fill(fixtureSecrets.TESTBED_WRONG_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(LOGIN_ERROR_MESSAGE);
  await expect(page.getByText("Signed in as")).toHaveCount(0);
  const reported = (await alert.textContent()) ?? "";
  const result = await oracle(l1LoginWrongPassword.id, reported);
  expect(result, JSON.stringify(result.checks)).toMatchObject({ pass: true });
  expect((await oracle(l1LoginWrongPassword.id, "I signed in")).pass).toBe(false);
});

test("l1-update-profile: change name and title, then save", async ({ page, context }) => {
  await prepare(l1UpdateProfile, context, page);
  expect((await oracle(l1UpdateProfile.id)).pass).toBe(false);

  await page.getByLabel("Display name").fill(L1_UPDATE_PROFILE_TARGET.name);
  await page.getByLabel("Job title").fill(L1_UPDATE_PROFILE_TARGET.title);
  await page.getByRole("button", { name: "Save profile" }).click();

  await expect(page.getByRole("status").filter({ hasText: PROFILE_SAVED_MESSAGE })).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveValue(L1_UPDATE_PROFILE_TARGET.name);
  const result = await oracle(l1UpdateProfile.id);
  expect(result, JSON.stringify(result.checks)).toMatchObject({ pass: true });

  await page.getByRole("link", { name: "Inbox" }).click();
  await expect(page.getByRole("heading", { name: "Your profile was updated" })).toBeVisible();
});

test("l1-form-validation: a taken handle is rejected, then a free one is saved", async ({
  page,
  context,
}) => {
  await prepare(l1FormValidation, context, page);
  expect((await oracle(l1FormValidation.id)).pass).toBe(false);
  const auditBefore = unwrap(await control.state()).audit.length;

  // Client validation: an invalid handle never reaches the server.
  const handle = page.getByLabel("Handle");
  await handle.fill("Not Valid!");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Handle must be 3 to 20 characters")).toBeVisible();
  await expect(handle).toHaveAttribute("aria-invalid", "true");
  await expect(handle).toBeFocused();
  expect(unwrap(await control.state()).audit.length).toBe(auditBefore);

  // Server validation: "bob" is well-formed but taken.
  await handle.fill(L1_FORM_VALIDATION_HANDLES.taken);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText(HANDLE_TAKEN_MESSAGE)).toBeVisible();
  expect((await oracle(l1FormValidation.id)).pass).toBe(false);

  await handle.fill(L1_FORM_VALIDATION_HANDLES.fallback);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: PROFILE_SAVED_MESSAGE })).toBeVisible();
  await expect(page.getByText(HANDLE_TAKEN_MESSAGE)).toHaveCount(0);
  const result = await oracle(l1FormValidation.id);
  expect(result, JSON.stringify(result.checks)).toMatchObject({ pass: true });
});

test("testids variant: data-testid appears only when reset turns it on", async ({ page }) => {
  unwrap(await control.reset({ seed: 42, variant: { testids: "on" } }));
  await page.goto("/login");
  await expect(page.getByTestId("login.email")).toBeVisible();

  unwrap(await control.reset({ seed: 42 }));
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.locator("[data-testid]")).toHaveCount(0);

  await page.goto("/login?testids=on");
  await expect(page.getByTestId("login.submit")).toBeVisible();
});
