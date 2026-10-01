// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L5 out-of-band auth: cookie names, messages, mail subjects and the status-message row. Browser-safe.
import { z } from "zod";

/** Pending two-step challenge after a correct password for a TOTP user. */
export const MFA_COOKIE = "gh_mfa";
/** Pending email-code sign-in, so a code only works in the browser that asked for it. */
export const EMAIL_CODE_COOKIE = "gh_email_code";
/** SSO `state`, checked when TestIdP redirects back. */
export const SSO_STATE_COOKIE = "gh_sso_state";

/** Named seeds (`POST /seed/:name`) for L5 tasks. */
export const AUTH_SEEDS = {
  /** Alice gets TOTP two-step verification (seed `TESTBED_TOTP`). */
  aliceTotp: "alice-totp",
  /** The next session that saves anything gets expired server-side, once. */
  sessionExpiry: "session-expiry",
} as const;

export const AUTH_MAIL_SUBJECTS = {
  magicLink: "Your sign-in link",
  emailCode: "Your sign-in code",
  passwordReset: "Reset your password",
  passwordChanged: "Your password was changed",
} as const;

export const AUTH_MESSAGES = {
  totpPrompt: "Enter the 6-digit code from your authenticator app.",
  totpInvalid: "That code didn't work. Check your authenticator app and try again.",
  totpExpired: "Your sign-in attempt expired. Sign in again.",
  linkSent: "Check your email. If an account exists for that address, we sent it a sign-in link.",
  codeSent: "Check your email. If an account exists for that address, we sent it a 6-digit code.",
  codeInvalid: "That code is not correct or has expired.",
  linkInvalid: "This sign-in link is invalid or was already used.",
  resetSent: "Check your email. If an account exists for that address, we sent it a password reset link.",
  resetInvalid: "This reset link is invalid or was already used.",
  resetMismatch: "Enter the same new password twice (8+ characters).",
  passwordReset: "Your password was reset. Sign in with your new password.",
  sessionExpired: "Your session has expired. Sign in again to save your changes.",
  statusSaved: "Status saved.",
  ssoDenied: "Sign-in with TestIdP was cancelled.",
  ssoFailed: "Sign-in with TestIdP failed. Try again.",
} as const;

/** The IdP's display name and the OAuth client id the testbed uses with it. */
export const IDP_NAME = "TestIdP";
export const IDP_CLIENT_ID = "ghosthand-testbed";

export const STATUS_MAX = 80;

export const StatusRow = z.object({ userId: z.number().int(), message: z.string() });
export type StatusRow = z.infer<typeof StatusRow>;

export const StatusInput = z.object({ message: z.string().trim().max(STATUS_MAX) });
export type StatusInput = z.infer<typeof StatusInput>;

/** Only same-origin paths are accepted as a post-sign-in destination. */
export function safeNextPath(next: string | null | undefined): string | undefined {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return undefined;
  return next;
}
