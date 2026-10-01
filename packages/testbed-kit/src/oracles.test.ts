// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import type { AuditRow, TestbedState, UserRow } from "./control-schemas.ts";
import { ALICE_EMAIL, BOB_EMAIL, HANDLE_TAKEN_MESSAGE, LOGIN_ERROR_MESSAGE } from "./fixtures.ts";
import { l1FormValidation } from "./tasks/l1-form-validation.ts";
import { l1Login } from "./tasks/l1-login.ts";
import { l1LoginWrongPassword } from "./tasks/l1-login-wrong-password.ts";
import { l1UpdateProfile } from "./tasks/l1-update-profile.ts";

const alice: UserRow = {
  id: 1,
  email: ALICE_EMAIL,
  name: "Alice Archer",
  handle: "alice",
  title: "Engineer",
  website: "https://alice.example",
  bio: "Hi",
};
const bob: UserRow = { ...alice, id: 2, email: BOB_EMAIL, name: "Bob Ng", handle: "bob" };

function state(overrides: Partial<TestbedState> = {}): TestbedState {
  return {
    seed: 42,
    variant: { testids: "off", a11y: "good" },
    now: "2026-03-02T09:00:00.000Z",
    users: [alice, bob],
    initialUsers: [alice, bob],
    sessions: [],
    audit: [],
    mail: [],
    customers: [],
    orders: [],
    initialOrders: [],
    settings: [],
    initialSettings: [],
    bios: [],
    initialBios: [],
    cart: [],
    pickupStores: [],
    ...overrides,
  };
}

let auditId = 0;
function audit(row: Partial<AuditRow> & Pick<AuditRow, "action" | "outcome">): AuditRow {
  auditId += 1;
  return {
    id: auditId,
    at: "2026-03-02T09:00:00.000Z",
    actor: ALICE_EMAIL,
    method: "POST",
    path: "/api/x",
    detail: {},
    ...row,
  };
}

describe("l1-login oracle", () => {
  it("fails on a fresh reset and passes after a successful login", () => {
    expect(l1Login.oracle(state(), {}).pass).toBe(false);
    const done = state({
      sessions: [{ userId: 1, createdAt: "x" }],
      audit: [audit({ action: "auth.login", outcome: "ok" })],
    });
    expect(l1Login.oracle(done, {})).toEqual({
      pass: true,
      checks: {
        aliceHasSession: true,
        onlyAliceHasSession: true,
        loginAudited: true,
        onlyLoginActions: true,
        usersUnchanged: true,
      },
    });
  });

  it("fails when bob is signed in instead", () => {
    const wrong = state({
      sessions: [{ userId: 2, createdAt: "x" }],
      audit: [audit({ action: "auth.login", outcome: "ok", actor: BOB_EMAIL })],
    });
    expect(l1Login.oracle(wrong, {}).pass).toBe(false);
  });
});

describe("l1-login-wrong-password oracle", () => {
  const failed = audit({
    action: "auth.login",
    outcome: "rejected",
    actor: "anonymous",
    detail: { email: ALICE_EMAIL, reason: "bad_credentials", message: LOGIN_ERROR_MESSAGE },
  });

  it("needs a recorded failed attempt and no session", () => {
    expect(l1LoginWrongPassword.oracle(state(), {}).pass).toBe(false);
    expect(l1LoginWrongPassword.oracle(state({ audit: [failed] }), {}).pass).toBe(true);
    const loggedIn = state({ audit: [failed], sessions: [{ userId: 1, createdAt: "x" }] });
    expect(l1LoginWrongPassword.oracle(loggedIn, {}).pass).toBe(false);
  });

  it("checks the reported answer when one is given", () => {
    const s = state({ audit: [failed] });
    expect(l1LoginWrongPassword.oracle(s, { answer: "The page said: invalid email or password" }).pass).toBe(
      true,
    );
    expect(l1LoginWrongPassword.oracle(s, { answer: "It worked" }).checks.errorReported).toBe(false);
  });
});

describe("l1-update-profile oracle", () => {
  it("passes only when name, title, audit and mail are all right", () => {
    expect(l1UpdateProfile.oracle(state(), {}).pass).toBe(false);
    const updated = { ...alice, name: "Alice Moreau", title: "Staff Engineer" };
    const done = state({
      users: [updated, bob],
      audit: [audit({ action: "profile.update", outcome: "ok" })],
      mail: [{ id: 1, at: "x", to: ALICE_EMAIL, from: "a", subject: "Your profile was updated", body: "" }],
    });
    expect(l1UpdateProfile.oracle(done, {}).pass).toBe(true);
    const tooMuch = state({ ...done, users: [{ ...updated, bio: "changed" }, bob] });
    expect(l1UpdateProfile.oracle(tooMuch, {}).checks.otherFieldsUnchanged).toBe(false);
  });
});

describe("l1-form-validation oracle", () => {
  it("requires the taken handle to have been rejected by the server", () => {
    const updated = { ...alice, handle: "alice-dev" };
    const noRejection = state({
      users: [updated, bob],
      audit: [audit({ action: "profile.update", outcome: "ok" })],
    });
    expect(l1FormValidation.oracle(noRejection, {}).checks.takenHandleRejected).toBe(false);
    const done = state({
      users: [updated, bob],
      audit: [
        audit({
          action: "profile.update",
          outcome: "rejected",
          detail: { fieldErrors: { handle: HANDLE_TAKEN_MESSAGE } },
        }),
        audit({ action: "profile.update", outcome: "ok" }),
      ],
    });
    expect(l1FormValidation.oracle(done, {}).pass).toBe(true);
  });
});
