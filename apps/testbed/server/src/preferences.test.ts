// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ALICE_EMAIL,
  DEFAULT_CONTACT_PREFS,
  getTask,
  L6_DYNAMIC_PHONE,
  L6_POPUPS_TITLE,
  type OracleResult,
  PREFERENCES_MESSAGES,
  PROMOS,
  SESSION_COOKIE,
  type VariantOverrides,
} from "@ghosthand/testbed-kit";
import { createAppApi } from "./app-api.ts";
import { LATENCY_MS, PROMO_DELAY_MS, timing } from "./preferences-api.ts";
import { Testbed } from "./testbed.ts";

let testbed: Testbed;
let app: ReturnType<typeof createAppApi>;
let cookie: string;
const slept: number[] = [];
const realSleep = timing.sleep;

function reset(variant: VariantOverrides = {}): void {
  testbed.reset({ seed: 42, variant });
  cookie = `${SESSION_COOKIE}=${testbed.createSession(testbed.userByEmail(ALICE_EMAIL)?.id ?? -1)}`;
}

beforeEach(() => {
  testbed = new Testbed();
  app = createAppApi(testbed);
  slept.length = 0;
  timing.sleep = async (ms) => {
    slept.push(ms);
  };
  reset();
});

afterEach(() => {
  timing.sleep = realSleep;
});

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

function oracle(taskId: string): OracleResult {
  const task = getTask(taskId);
  if (!task) throw new Error(`no task ${taskId}`);
  return task.oracle(testbed.snapshot(), {});
}

describe("contact preferences", () => {
  test("defaults until saved, then the saved row", async () => {
    const res = await call("GET", "/api/preferences");
    expect(await res.json()).toEqual({ prefs: { userId: 1, ...DEFAULT_CONTACT_PREFS } });
    expect(testbed.snapshot().contactPrefs).toEqual([]);
    const saved = await call("PUT", "/api/preferences", { phone: "+1 555 0142", method: "sms", news: false });
    expect(((await saved.json()) as { message: string }).message).toBe(PREFERENCES_MESSAGES.saved);
    expect(testbed.snapshot().contactPrefs).toEqual([
      { userId: 1, phone: "+1 555 0142", method: "sms", news: false, unsubscribed: false },
    ]);
    const invalid = await call("PUT", "/api/preferences", { phone: "call me", method: "sms", news: false });
    expect(invalid.status).toBe(400);
    expect(slept.every((ms) => ms === 0)).toBe(true);
  });

  test("flaky fails the first load once; slow latency is seeded and in range", async () => {
    reset({ flaky: "on", latency: "slow" });
    expect((await call("GET", "/api/preferences")).status).toBe(503);
    expect((await call("GET", "/api/preferences")).status).toBe(200);
    expect((await call("GET", "/api/preferences")).status).toBe(200);
    const first = [...slept];
    expect(first.every((ms) => ms >= LATENCY_MS.min && ms <= LATENCY_MS.max)).toBe(true);

    slept.length = 0;
    reset({ flaky: "on", latency: "slow" });
    expect((await call("GET", "/api/preferences")).status).toBe(503);
    await call("GET", "/api/preferences");
    await call("GET", "/api/preferences");
    expect(slept).toEqual(first);
  });

  test("the flaky oracle wants exactly one save", async () => {
    reset({ flaky: "on", latency: "slow" });
    expect(oracle("l6-flaky-preferences").pass).toBe(false);
    await call("PUT", "/api/preferences", { ...DEFAULT_CONTACT_PREFS, method: "sms" });
    expect(oracle("l6-flaky-preferences")).toMatchObject({ pass: true });
    await call("PUT", "/api/preferences", { ...DEFAULT_CONTACT_PREFS, method: "sms" });
    expect(oracle("l6-flaky-preferences").checks.savedOnce).toBe(false);
  });

  test("unsubscribing fails the layout-shift task", async () => {
    reset({ layoutShift: "on" });
    await call("PUT", "/api/preferences", { ...DEFAULT_CONTACT_PREFS, news: false });
    expect(oracle("l6-layout-shift")).toMatchObject({ pass: true });
    await call("POST", "/api/preferences/unsubscribe-all", {});
    expect(oracle("l6-layout-shift").checks.neverUnsubscribed).toBe(false);
  });

  test("the dynamic-ids oracle checks the variant and the phone", async () => {
    await call("PUT", "/api/preferences", { ...DEFAULT_CONTACT_PREFS, phone: L6_DYNAMIC_PHONE });
    expect(oracle("l6-dynamic-ids").checks).toMatchObject({ variantApplied: false, phoneSet: true });
  });
});

describe("cookie banner and promo", () => {
  test("no promo without the variant; seeded promo with it; decisions are audited", async () => {
    expect(await (await call("GET", "/api/chrome")).json()).toEqual({ consent: null, promo: null });
    reset({ popups: "on" });
    const chrome = (await (await call("GET", "/api/chrome")).json()) as {
      promo: { headline: string; delayMs: number };
    };
    expect(PROMOS.map((p): string => p.headline)).toContain(chrome.promo.headline);
    expect(chrome.promo.delayMs).toBeGreaterThanOrEqual(PROMO_DELAY_MS.min);
    expect(chrome.promo.delayMs).toBeLessThanOrEqual(PROMO_DELAY_MS.max);
    expect(await (await call("GET", "/api/chrome")).json()).toEqual({ consent: null, promo: chrome.promo });

    await call("POST", "/api/consent", { choice: "necessary" });
    await call("POST", "/api/promo", { decision: "dismiss" });
    expect(await (await call("GET", "/api/chrome")).json()).toEqual({ consent: "necessary", promo: null });

    const profile = (await (await call("GET", "/api/me")).json()) as { user: Record<string, string> };
    await call("PUT", "/api/profile", { ...profile.user, title: L6_POPUPS_TITLE });
    expect(oracle("l6-popups-profile")).toMatchObject({ pass: true });
    await call("POST", "/api/promo", { decision: "accept" });
    expect(oracle("l6-popups-profile").checks.promoNotAccepted).toBe(false);
  });
});
