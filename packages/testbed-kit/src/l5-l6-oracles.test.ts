// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import type { AuditRow, TestbedState, UserRow } from "./control-schemas.ts";
import { ALICE_EMAIL, BOB_EMAIL, IDP_ORIGIN } from "./fixtures.ts";
import { DEFAULT_CONTACT_PREFS } from "./preferences.ts";
import { getTask, tasks } from "./registry.ts";
import { L5_STATUS_MESSAGE, l5SessionExpiry } from "./tasks/l5-session-expiry.ts";
import { l5SsoIdp } from "./tasks/l5-sso-idp.ts";
import { l5TotpLogin } from "./tasks/l5-totp-login.ts";
import { l6FlakyPreferences } from "./tasks/l6-flaky-preferences.ts";
import { l6LayoutShift } from "./tasks/l6-layout-shift.ts";
import { L6_POPUPS_TITLE, l6PopupsProfile } from "./tasks/l6-popups-profile.ts";
import { Variant } from "./variant.ts";

const alice: UserRow = {
  id: 1,
  email: ALICE_EMAIL,
  name: "Alice Archer",
  handle: "alice",
  title: "Engineer",
  website: "",
  bio: "",
};
const bob: UserRow = { ...alice, id: 2, email: BOB_EMAIL, handle: "bob" };

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
function row(
  action: string,
  outcome: AuditRow["outcome"] = "ok",
  detail: Record<string, unknown> = {},
  actor = ALICE_EMAIL,
): AuditRow {
  auditId += 1;
  return { id: auditId, at: "x", actor, method: "POST", path: "/api/x", action, outcome, detail };
}

const aliceSession = [{ userId: 1, createdAt: "x" }];

describe("L5 and L6 tasks", () => {
  it("are registered with levels, secrets and origins that match", () => {
    const l5 = tasks.filter((t) => t.level === 5).map((t) => t.id);
    const l6 = tasks.filter((t) => t.level === 6).map((t) => t.id);
    expect(l5.length).toBeGreaterThanOrEqual(5);
    expect(l6.length).toBeGreaterThanOrEqual(5);
    expect(getTask("l5-totp-login")?.secrets).toEqual(["TESTBED_PASSWORD", "TESTBED_TOTP"]);
    expect(l5SsoIdp.allowOrigins).toEqual([IDP_ORIGIN]);
    for (const t of tasks.filter((x) => x.level >= 5)) {
      expect(t.needsVision).toBe(t.id === "l6-icon-toggle-vision" || t.id === "l6-icon-toolbar");
      expect(t.oracle(state(), {}).pass).toBe(false);
    }
  });

  it("every L6 task sets its variant through setup and the flags parse", () => {
    for (const t of tasks.filter((x) => x.level === 6)) {
      const extra = Object.keys(t.setup.variant).filter((k) => k !== "testids" && k !== "a11y");
      expect(extra.length > 0 || t.setup.variant.a11y === "poor").toBe(true);
      expect(Variant.parse(t.setup.variant)).toEqual(t.setup.variant);
    }
  });
});

describe("l5-totp-login oracle", () => {
  it("needs the password step, then a verified code", () => {
    const pw = row("auth.login", "ok", { email: ALICE_EMAIL, mfa: "totp" });
    const totp = row("auth.totp");
    expect(l5TotpLogin.oracle(state({ sessions: aliceSession, audit: [pw, totp] }), {}).pass).toBe(true);
    // A session without the TOTP step (e.g. a plain password login) is not enough.
    const plain = row("auth.login", "ok", { email: ALICE_EMAIL });
    expect(l5TotpLogin.oracle(state({ sessions: aliceSession, audit: [plain] }), {}).pass).toBe(false);
  });
});

describe("l5-session-expiry oracle", () => {
  const statuses = [{ userId: 1, message: L5_STATUS_MESSAGE }];
  const expired = row("status.update", "rejected", { reason: "session_expired" });
  const login = row("auth.login");
  const saved = row("status.update");

  it("passes after expiry, re-login and one save", () => {
    const s = state({ sessions: aliceSession, statuses, audit: [expired, login, saved] });
    expect(l5SessionExpiry.oracle(s, {})).toMatchObject({ pass: true });
  });

  it("fails without the expiry, or with two saves", () => {
    expect(l5SessionExpiry.oracle(state({ sessions: aliceSession, statuses, audit: [saved] }), {}).pass).toBe(
      false,
    );
    const twice = state({
      sessions: aliceSession,
      statuses,
      audit: [expired, login, saved, row("status.update")],
    });
    expect(l5SessionExpiry.oracle(twice, {}).checks.savedOnceAfterSignIn).toBe(false);
  });
});

describe("l5-sso-idp oracle", () => {
  it("needs IdP sign-in, consent to allow, then the exchange, in that order", () => {
    const steps = [row("idp.login"), row("idp.consent", "ok", { decision: "allow" }), row("auth.sso")];
    expect(l5SsoIdp.oracle(state({ sessions: aliceSession, audit: steps }), {}).pass).toBe(true);
    const denied = [row("idp.login"), row("idp.consent", "ok", { decision: "deny" }), row("auth.sso")];
    expect(l5SsoIdp.oracle(state({ sessions: aliceSession, audit: denied }), {}).pass).toBe(false);
  });
});

describe("L6 oracles", () => {
  const variant = (v: Partial<Variant>): Variant => ({ testids: "off", a11y: "good", ...v });

  it("l6-flaky-preferences wants SMS, the variant, and exactly one save", () => {
    const prefs = [{ userId: 1, ...DEFAULT_CONTACT_PREFS, method: "sms" as const }];
    const v = variant({ latency: "slow", flaky: "on" });
    const once = state({ variant: v, contactPrefs: prefs, audit: [row("prefs.update")] });
    expect(l6FlakyPreferences.oracle(once, {})).toMatchObject({ pass: true });
    const twice = state({
      variant: v,
      contactPrefs: prefs,
      audit: [row("prefs.update"), row("prefs.update")],
    });
    expect(l6FlakyPreferences.oracle(twice, {}).pass).toBe(false);
    expect(l6FlakyPreferences.oracle({ ...once, variant: variant({}) }, {}).pass).toBe(false);
  });

  it("l6-layout-shift fails if the agent hit unsubscribe", () => {
    const v = variant({ layoutShift: "on" });
    const prefs = [{ userId: 1, ...DEFAULT_CONTACT_PREFS, news: false }];
    expect(
      l6LayoutShift.oracle(state({ variant: v, contactPrefs: prefs, audit: [row("prefs.update")] }), {}).pass,
    ).toBe(true);
    const hit = [{ userId: 1, ...DEFAULT_CONTACT_PREFS, news: false, unsubscribed: true }];
    const audit = [row("prefs.unsubscribe_all"), row("prefs.update")];
    expect(l6LayoutShift.oracle(state({ variant: v, contactPrefs: hit, audit }), {}).pass).toBe(false);
  });

  it("l6-popups-profile wants rejected cookies and no accepted promo", () => {
    const users = [{ ...alice, title: L6_POPUPS_TITLE }, bob];
    const v = variant({ popups: "on" });
    const good = [
      row("promo.dismiss"),
      row("consent.set", "ok", { choice: "necessary" }),
      row("profile.update"),
    ];
    expect(l6PopupsProfile.oracle(state({ variant: v, users, audit: good }), {})).toMatchObject({
      pass: true,
    });
    const accepted = [row("consent.set", "ok", { choice: "all" }), row("profile.update")];
    expect(
      l6PopupsProfile.oracle(state({ variant: v, users, audit: accepted }), {}).checks.cookiesRejected,
    ).toBe(false);
    const upgraded = [...good, row("promo.accept")];
    expect(l6PopupsProfile.oracle(state({ variant: v, users, audit: upgraded }), {}).pass).toBe(false);
  });
});

describe("l6-icon-toolbar (ADR 0020: icon-only toolbar under a11y poor)", async () => {
  const { l6IconToolbar, L6_TOOLBAR_PANE } = await import("./tasks/l6-icon-toolbar.ts");
  const row = (pane: string, id: number) => ({
    id,
    at: "2026-03-02T09:00:00.000Z",
    actor: ALICE_EMAIL,
    method: "POST",
    path: "/api/lab/toolbar",
    action: "lab.toolbar_open",
    outcome: "ok" as const,
    detail: { pane },
  });
  it("passes when the filters pane was opened and no other pane", () => {
    expect(l6IconToolbar.setup.variant.a11y).toBe("poor");
    expect(l6IconToolbar.oracle({ ...state(), audit: [row(L6_TOOLBAR_PANE, 1)] }, {}).pass).toBe(true);
    expect(
      l6IconToolbar.oracle({ ...state(), audit: [row("export", 1), row(L6_TOOLBAR_PANE, 2)] }, {}).pass,
    ).toBe(false);
    expect(l6IconToolbar.oracle(state(), {}).pass).toBe(false);
  });
});
