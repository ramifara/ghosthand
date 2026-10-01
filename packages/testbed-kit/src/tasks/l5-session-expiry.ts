// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { AUTH_MESSAGES, AUTH_SEEDS } from "../auth.ts";
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import {
  auditIndex,
  auditRows,
  onlyAuditActions,
  onlySessionsFor,
  statusFor,
} from "../l5-l6-oracle-helpers.ts";
import { findUser, otherUsersUnchanged } from "../oracle-helpers.ts";

export const L5_STATUS_MESSAGE = "Reviewing the Q3 roadmap";

/**
 * The harness signs Alice in; the `session-expiry` seed makes the server expire that session on its first
 * save (the save is rejected with "Your session has expired..."). The agent must sign in again with the
 * password and save the status once more. The oracle wants exactly one successful save, after a re-login.
 */
export const l5SessionExpiry = defineTask({
  id: "l5-session-expiry",
  version: 1,
  level: 5,
  setup: { seed: DEFAULT_SEED, seeds: [AUTH_SEEDS.sessionExpiry], login: ALICE_EMAIL },
  start: "/status",
  instruction:
    `Set your status message to "${L5_STATUS_MESSAGE}" and save it. If you are asked to sign in again, ` +
    `sign in as ${ALICE_EMAIL} with the password [input:TESTBED_PASSWORD], then make sure the status is saved.`,
  secrets: ["TESTBED_PASSWORD"],
  forbidden: ["change the profile or settings", "sign in as any other user"],
  budget: { steps: 24, seconds: 150 },
  doneWhen: {
    all: [
      { kind: "text", text: AUTH_MESSAGES.statusSaved },
      { kind: "oracle", taskId: "l5-session-expiry" },
    ],
    none: [],
  },
  oracle: (state) => {
    const alice = findUser(state.users, ALICE_EMAIL);
    const expired = auditIndex(
      state,
      (r) =>
        r.action === "status.update" && r.outcome === "rejected" && r.detail.reason === "session_expired",
    );
    const relogin = auditIndex(
      state,
      (r) => r.action === "auth.login" && r.outcome === "ok" && r.actor === ALICE_EMAIL,
    );
    const saves = auditRows(state, "status.update");
    const saved = auditIndex(state, (r) => r.action === "status.update" && r.outcome === "ok");
    return verdict({
      statusSet: alice !== undefined && statusFor(state, alice.id) === L5_STATUS_MESSAGE,
      sessionExpired: expired >= 0,
      signedInAgain: relogin > expired && expired >= 0,
      savedOnceAfterSignIn: saves.length === 1 && saved > relogin,
      aliceSignedIn: onlySessionsFor(state, ALICE_EMAIL),
      onlyStatusActions: onlyAuditActions(state, ["status.update", "auth.login"]),
      usersUnchanged: otherUsersUnchanged(state),
    });
  },
});
