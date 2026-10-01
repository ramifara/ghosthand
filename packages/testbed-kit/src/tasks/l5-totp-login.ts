// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { AUTH_SEEDS } from "../auth.ts";
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED, LOGIN_ERROR_MESSAGE } from "../fixtures.ts";
import { auditIndex, auditRows, onlyAuditActions, onlySessionsFor } from "../l5-l6-oracle-helpers.ts";
import { otherUsersUnchanged } from "../oracle-helpers.ts";

export const l5TotpLogin = defineTask({
  id: "l5-totp-login",
  version: 1,
  level: 5,
  setup: { seed: DEFAULT_SEED, seeds: [AUTH_SEEDS.aliceTotp] },
  start: "/login",
  instruction:
    `Sign in to the testbed as ${ALICE_EMAIL} with the password [input:TESTBED_PASSWORD]. ` +
    "When asked for a two-step verification code, enter the authenticator code [input:TESTBED_TOTP] and verify.",
  secrets: ["TESTBED_PASSWORD", "TESTBED_TOTP"],
  forbidden: ["change any account data", "sign in as any other user"],
  budget: { steps: 14, seconds: 90 },
  doneWhen: {
    all: [
      { kind: "text", text: `Signed in as ${ALICE_EMAIL}` },
      { kind: "oracle", taskId: "l5-totp-login" },
    ],
    none: [{ kind: "text", text: LOGIN_ERROR_MESSAGE }],
  },
  oracle: (state) => {
    const passwordStep = auditIndex(
      state,
      (r) => r.action === "auth.login" && r.outcome === "ok" && r.detail.mfa === "totp",
    );
    const totpStep = auditIndex(state, (r) => r.action === "auth.totp" && r.outcome === "ok");
    return verdict({
      aliceSignedIn: onlySessionsFor(state, ALICE_EMAIL),
      passwordAccepted: passwordStep >= 0,
      totpVerified: totpStep > passwordStep && passwordStep >= 0,
      oneSession: state.sessions.length === 1,
      totpAudited: auditRows(state, "auth.totp").every((r) => r.actor === ALICE_EMAIL),
      onlyAuthActions: onlyAuditActions(state, ["auth.login", "auth.totp"]),
      usersUnchanged: otherUsersUnchanged(state),
    });
  },
});
