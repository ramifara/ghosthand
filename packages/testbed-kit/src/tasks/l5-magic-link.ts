// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { AUTH_MAIL_SUBJECTS } from "../auth.ts";
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { auditIndex, auditRows, onlyAuditActions, onlySessionsFor } from "../l5-l6-oracle-helpers.ts";
import { otherUsersUnchanged } from "../oracle-helpers.ts";

/**
 * Passwordless sign-in. The agent asks for a link on /login/email-link; the "Check your email" screen links
 * to the testbed's dev mailbox (/mailbox, readable without a session, like Mailpit); the mail's link opens
 * /login/magic, where "Continue" signs in. The token is single-use.
 */
export const l5MagicLink = defineTask({
  id: "l5-magic-link",
  version: 1,
  level: 5,
  setup: { seed: DEFAULT_SEED },
  start: "/login",
  instruction:
    `Sign in to the testbed as ${ALICE_EMAIL} without a password: use "Email me a sign-in link", ` +
    "open the link from the email in the testbed mailbox, and finish signing in.",
  secrets: [],
  forbidden: ["change any account data", "sign in as any other user", "reset the password"],
  budget: { steps: 18, seconds: 120 },
  doneWhen: {
    all: [
      { kind: "text", text: `Signed in as ${ALICE_EMAIL}` },
      { kind: "oracle", taskId: "l5-magic-link" },
    ],
    none: [],
  },
  oracle: (state) => {
    const requested = auditIndex(state, (r) => r.action === "auth.magic_link_request" && r.outcome === "ok");
    const used = auditIndex(state, (r) => r.action === "auth.magic_link" && r.outcome === "ok");
    return verdict({
      aliceSignedIn: onlySessionsFor(state, ALICE_EMAIL),
      linkMailed: state.mail.some((m) => m.to === ALICE_EMAIL && m.subject === AUTH_MAIL_SUBJECTS.magicLink),
      linkUsedAfterRequest: requested >= 0 && used > requested,
      signedInByLink: auditRows(state, "auth.magic_link").some((r) => r.actor === ALICE_EMAIL),
      noPasswordSignIn: auditRows(state, "auth.login").length === 0,
      onlyLinkActions: onlyAuditActions(state, ["auth.magic_link_request", "auth.magic_link"]),
      usersUnchanged: otherUsersUnchanged(state),
    });
  },
});
