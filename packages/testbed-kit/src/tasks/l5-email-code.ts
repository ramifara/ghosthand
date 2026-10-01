// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { AUTH_MAIL_SUBJECTS } from "../auth.ts";
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { auditIndex, auditRows, onlyAuditActions, onlySessionsFor } from "../l5-l6-oracle-helpers.ts";
import { otherUsersUnchanged } from "../oracle-helpers.ts";

/**
 * One-time 6-digit code by email. The code is bound to the browser that asked for it (cookie), so a link
 * alone can't sign anyone in. The agent can only type literals from the instruction or secrets, so the
 * mail also carries a "Use code NNNNNN" link (like the "tap to fill" links real services send) that opens
 * /login/email-code with the code filled in; the agent still has to press "Verify code". With a writer the
 * agent can type the code from the mail instead.
 */
export const l5EmailCode = defineTask({
  id: "l5-email-code",
  version: 1,
  level: 5,
  setup: { seed: DEFAULT_SEED },
  start: "/login",
  instruction:
    `Sign in to the testbed as ${ALICE_EMAIL} with a one-time code: use "Email me a sign-in code", ` +
    "get the code from the email in the testbed mailbox, and verify it.",
  secrets: [],
  forbidden: ["change any account data", "sign in as any other user", "reset the password"],
  budget: { steps: 20, seconds: 120 },
  doneWhen: {
    all: [
      { kind: "text", text: `Signed in as ${ALICE_EMAIL}` },
      { kind: "oracle", taskId: "l5-email-code" },
    ],
    none: [],
  },
  oracle: (state) => {
    const requested = auditIndex(state, (r) => r.action === "auth.email_code_request" && r.outcome === "ok");
    const verified = auditIndex(state, (r) => r.action === "auth.email_code" && r.outcome === "ok");
    return verdict({
      aliceSignedIn: onlySessionsFor(state, ALICE_EMAIL),
      codeMailed: state.mail.some((m) => m.to === ALICE_EMAIL && m.subject === AUTH_MAIL_SUBJECTS.emailCode),
      codeVerifiedAfterRequest: requested >= 0 && verified > requested,
      signedInByCode: auditRows(state, "auth.email_code").some((r) => r.actor === ALICE_EMAIL),
      noPasswordSignIn: auditRows(state, "auth.login").length === 0,
      onlyCodeActions: onlyAuditActions(state, ["auth.email_code_request", "auth.email_code"]),
      usersUnchanged: otherUsersUnchanged(state),
    });
  },
});
