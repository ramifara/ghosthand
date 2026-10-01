// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L5 out-of-band auth: performs each task like a person (reading mail in the dev mailbox) and checks the
// oracle fails before and passes after.
import {
  ALICE_EMAIL,
  APP_ORIGIN,
  AUTH_MAIL_SUBJECTS,
  AUTH_MESSAGES,
  fixtureSecrets,
  IDP_NAME,
  IDP_ORIGIN,
  L5_STATUS_MESSAGE,
  l5EmailCode,
  l5MagicLink,
  l5PasswordReset,
  l5SessionExpiry,
  l5SsoIdp,
  l5TotpLogin,
} from "@ghosthand/testbed-kit";
import { expect, type Page, test } from "@playwright/test";
import { Secret, TOTP } from "otpauth";
import { expectOracleFails, expectOraclePasses, prepare } from "./control.ts";

async function signInWithPassword(page: Page, password: string): Promise<void> {
  await page.getByLabel("Email", { exact: true }).fill(ALICE_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Opens the dev mailbox from a "Check your email" screen and the newest mail with `subject`. */
async function openMail(page: Page, subject: string) {
  await page.getByRole("link", { name: "Open the testbed mailbox" }).click();
  await expect(page.getByRole("heading", { name: "Testbed mailbox" })).toBeVisible();
  const mail = page.getByRole("article", { name: subject }).first();
  await expect(mail).toBeVisible();
  return mail;
}

test("l5-totp-login: password, then the authenticator code", async ({ page, context }) => {
  await prepare(l5TotpLogin, context, page);
  await expectOracleFails(l5TotpLogin.id);

  await signInWithPassword(page, fixtureSecrets.TESTBED_PASSWORD);
  await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  await expect(page.getByText(AUTH_MESSAGES.totpPrompt)).toBeVisible();
  await expect(page.getByText("Signed in as")).toHaveCount(0);

  const code = new TOTP({ secret: Secret.fromBase32(fixtureSecrets.TESTBED_TOTP) }).generate();
  await page.getByLabel("Authentication code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByText(`Signed in as ${ALICE_EMAIL}`)).toBeVisible();
  await expectOraclePasses(l5TotpLogin.id);
});

test("l5-magic-link: request a link, open it from the mailbox, continue", async ({ page, context }) => {
  await prepare(l5MagicLink, context, page);
  await expectOracleFails(l5MagicLink.id);

  await page.getByRole("link", { name: "Email me a sign-in link" }).click();
  await page.getByLabel("Email", { exact: true }).fill(ALICE_EMAIL);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status").filter({ hasText: AUTH_MESSAGES.linkSent })).toBeVisible();

  const mail = await openMail(page, AUTH_MAIL_SUBJECTS.magicLink);
  await mail.getByRole("link", { name: "Sign in to the testbed" }).click();
  await expect(page.getByText(`Continue to sign in as ${ALICE_EMAIL}`)).toBeVisible();
  await expectOracleFails(l5MagicLink.id);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText(`Signed in as ${ALICE_EMAIL}`)).toBeVisible();
  await expectOraclePasses(l5MagicLink.id);
});

test("l5-email-code: request a code, fill it from the mailbox, verify", async ({ page, context }) => {
  await prepare(l5EmailCode, context, page);
  await expectOracleFails(l5EmailCode.id);

  await page.getByRole("link", { name: "Email me a sign-in code" }).click();
  await page.getByLabel("Email", { exact: true }).fill(ALICE_EMAIL);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible();

  const mail = await openMail(page, AUTH_MAIL_SUBJECTS.emailCode);
  const link = mail.getByRole("link", { name: /^Use code \d{6}$/ });
  const code = ((await link.textContent()) ?? "").replace(/\D/g, "");
  await expect(mail).toContainText(`Your testbed sign-in code is ${code}`);
  await link.click();
  await expect(page.getByLabel("6-digit code")).toHaveValue(code);
  await page.getByRole("button", { name: "Verify code" }).click();

  await expect(page.getByText(`Signed in as ${ALICE_EMAIL}`)).toBeVisible();
  await expectOraclePasses(l5EmailCode.id);
});

test("l5-password-reset: reset by mail, then sign in with the new password", async ({ page, context }) => {
  await prepare(l5PasswordReset, context, page);
  await expectOracleFails(l5PasswordReset.id);

  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.getByLabel("Email", { exact: true }).fill(ALICE_EMAIL);
  await page.getByRole("button", { name: "Send reset link" }).click();
  const mail = await openMail(page, AUTH_MAIL_SUBJECTS.passwordReset);
  await mail.getByRole("link", { name: "Choose a new password" }).click();

  const next = fixtureSecrets.TESTBED_NEW_PASSWORD;
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Confirm new password").fill(next);
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByText(AUTH_MESSAGES.passwordReset)).toBeVisible();

  await signInWithPassword(page, next);
  await expect(page.getByText(`Signed in as ${ALICE_EMAIL}`)).toBeVisible();
  await expectOraclePasses(l5PasswordReset.id);
});

test("l5-session-expiry: the save is rejected, sign in again, save once more", async ({ page, context }) => {
  await prepare(l5SessionExpiry, context, page);
  await expectOracleFails(l5SessionExpiry.id);

  await page.getByLabel("Status message").fill(L5_STATUS_MESSAGE);
  await page.getByRole("button", { name: "Save status" }).click();
  await expect(page.getByRole("alert")).toContainText(AUTH_MESSAGES.sessionExpired);
  await page.getByRole("link", { name: "Sign in again" }).click();

  await signInWithPassword(page, fixtureSecrets.TESTBED_PASSWORD);
  await expect(page).toHaveURL(`${APP_ORIGIN}/status?resumed=1`);
  await expect(page.getByText("You're signed in again.", { exact: false })).toBeVisible();
  await page.getByLabel("Status message").fill(L5_STATUS_MESSAGE);
  await page.getByRole("button", { name: "Save status" }).click();

  await expect(page.getByRole("status").filter({ hasText: AUTH_MESSAGES.statusSaved })).toBeVisible();
  await expectOraclePasses(l5SessionExpiry.id);
});

test("l5-sso-idp: sign in at TestIdP, allow, land back signed in", async ({ page, context }) => {
  await prepare(l5SsoIdp, context, page);
  await expectOracleFails(l5SsoIdp.id);

  await page.getByRole("link", { name: `Sign in with ${IDP_NAME}` }).click();
  await expect(page).toHaveURL(new RegExp(`^${IDP_ORIGIN}/authorize`));
  await expect(page.getByRole("heading", { name: `Sign in to ${IDP_NAME}` })).toBeVisible();
  await page.getByLabel("Email").fill(ALICE_EMAIL);
  await page.getByLabel("Password").fill(fixtureSecrets.TESTBED_IDP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /to access your account\?$/ })).toBeVisible();
  await page.getByRole("button", { name: "Allow" }).click();

  await expect(page).toHaveURL(`${APP_ORIGIN}/`);
  await expect(page.getByText(`Signed in as ${ALICE_EMAIL}`)).toBeVisible();
  await expectOraclePasses(l5SsoIdp.id);
});
