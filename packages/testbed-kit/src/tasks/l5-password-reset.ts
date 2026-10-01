// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { AUTH_MAIL_SUBJECTS } from "../auth.ts";
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED, LOGIN_ERROR_MESSAGE } from "../fixtures.ts";
import { auditIndex, auditRows, onlyAuditActions, onlySessionsFor } from "../l5-l6-oracle-helpers.ts";
import { otherUsersUnchanged } from "../oracle-helpers.ts";

/**
 * Forgot-password flow. The agent knows only the new password, so any successful password sign-in after
 * the reset proves the new password was set and used (the old one stops working at the reset).
 */
export const l5PasswordReset = defineTask({
  id: "l5-password-reset",
  version: 1,
  level: 5,
  setup: { seed: DEFAULT_SEED },
  start: "/login",
  instruction:
    `You forgot the password for ${ALICE_EMAIL}. From the sign-in page use "Forgot password?", ` +
    "open the reset link from the email in the testbed mailbox, set the new password " +
    `[input:TESTBED_NEW_PASSWORD] (type it in both fields), then sign in as ${ALICE_EMAIL} with the new password.`,
  secrets: ["TESTBED_NEW_PASSWORD"],
  forbidden: ["change the profile", "sign in as any other user"],
  budget: { steps: 24, seconds: 150 },
  doneWhen: {
    all: [
      { kind: "text", text: `Signed in as ${ALICE_EMAIL}` },
      { kind: "oracle", taskId: "l5-password-reset" },
    ],
    none: [{ kind: "text", text: LOGIN_ERROR_MESSAGE }],
  },
  oracle: (state) => {
    const reset = auditIndex(state, (r) => r.action === "auth.password_reset" && r.outcome === "ok");
    const loginAfter = auditIndex(
      state,
      (r) => r.action === "auth.login" && r.outcome === "ok" && r.actor === ALICE_EMAIL,
    );
    return verdict({
      resetMailed: state.mail.some(
        (m) => m.to === ALICE_EMAIL && m.subject === AUTH_MAIL_SUBJECTS.passwordReset,
      ),
      passwordReset: auditRows(state, "auth.password_reset").some((r) => r.actor === ALICE_EMAIL),
      signedInAfterReset: reset >= 0 && loginAfter > reset,
      aliceSignedIn: onlySessionsFor(state, ALICE_EMAIL),
      resetOnce: auditRows(state, "auth.password_reset").length === 1,
      onlyResetActions: onlyAuditActions(state, [
        "auth.password_reset_request",
        "auth.password_reset",
        "auth.login",
      ]),
      usersUnchanged: otherUsersUnchanged(state),
    });
  },
});
