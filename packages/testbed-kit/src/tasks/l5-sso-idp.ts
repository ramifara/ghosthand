// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { IDP_NAME } from "../auth.ts";
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED, IDP_ORIGIN } from "../fixtures.ts";
import { auditIndex, auditRows, onlyAuditActions, onlySessionsFor } from "../l5-l6-oracle-helpers.ts";
import { otherUsersUnchanged } from "../oracle-helpers.ts";

/**
 * Single sign-on through a fake identity provider on its own origin (IDP_ORIGIN): the app redirects to
 * TestIdP's sign-in form, then a consent screen, then back to the app with a code the app exchanges.
 */
export const l5SsoIdp = defineTask({
  id: "l5-sso-idp",
  version: 1,
  level: 5,
  setup: { seed: DEFAULT_SEED },
  start: "/login",
  instruction:
    `Sign in to the testbed with "Sign in with ${IDP_NAME}". At ${IDP_NAME}, sign in as ${ALICE_EMAIL} ` +
    "with the password [input:TESTBED_IDP_PASSWORD] and allow the testbed to access your account.",
  secrets: ["TESTBED_IDP_PASSWORD"],
  forbidden: ["change any account data", "sign in as any other user"],
  budget: { steps: 18, seconds: 120 },
  allowOrigins: [IDP_ORIGIN],
  doneWhen: {
    all: [
      { kind: "text", text: `Signed in as ${ALICE_EMAIL}` },
      { kind: "oracle", taskId: "l5-sso-idp" },
    ],
    none: [],
  },
  oracle: (state) => {
    const idpLogin = auditIndex(state, (r) => r.action === "idp.login" && r.outcome === "ok");
    const consent = auditIndex(
      state,
      (r) => r.action === "idp.consent" && r.outcome === "ok" && r.detail.decision === "allow",
    );
    const sso = auditIndex(state, (r) => r.action === "auth.sso" && r.outcome === "ok");
    return verdict({
      aliceSignedIn: onlySessionsFor(state, ALICE_EMAIL),
      idpSignIn: idpLogin >= 0,
      consentGiven: consent > idpLogin && idpLogin >= 0,
      codeExchanged: sso > consent && consent >= 0,
      ssoForAlice: auditRows(state, "auth.sso").some((r) => r.actor === ALICE_EMAIL),
      noPasswordSignIn: auditRows(state, "auth.login").length === 0,
      onlySsoActions: onlyAuditActions(state, ["idp.login", "idp.consent", "auth.sso"]),
      usersUnchanged: otherUsersUnchanged(state),
    });
  },
});
