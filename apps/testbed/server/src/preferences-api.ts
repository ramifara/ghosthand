// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L6 routes: contact preferences (seeded latency and a transient 503 under the latency/flaky variants),
// plus the cookie consent and promo state behind the `popups` variant.
import {
  ConsentChoice,
  ContactPrefsInput,
  type ContactPrefsRow,
  createRng,
  DEFAULT_CONTACT_PREFS,
  PREFERENCES_MESSAGES,
  PROMOS,
  PromoDecision,
  type Rng,
} from "@ghosthand/testbed-kit";
import type { Context, Hono } from "hono";
import type { Env } from "./audit-middleware.ts";
import { contactPrefsOf, saveContactPrefs } from "./auth-db.ts";
import { fact, setFact } from "./auth-tokens.ts";
import { readJson } from "./read-json.ts";
import { nameHash } from "./shop-seed.ts";
import type { Testbed } from "./testbed.ts";

export const LATENCY_MS = { min: 300, max: 2500 } as const;
export const PROMO_DELAY_MS = { min: 600, max: 1800 } as const;

const FLAKY_FACT = "flaky_preferences";
const CONSENT_FACT = "cookie_consent";
const PROMO_FACT = "promo_decision";

/** One latency PRNG per reset, so the n-th slow request after a reset always waits the same time. */
const latencyRngs = new WeakMap<Testbed, { resetId: number; rng: Rng }>();

function latencyFor(testbed: Testbed): number {
  if (testbed.variant.latency !== "slow") return 0;
  let entry = latencyRngs.get(testbed);
  if (!entry || entry.resetId !== testbed.resetId) {
    entry = { resetId: testbed.resetId, rng: createRng((testbed.seed ^ nameHash("latency")) >>> 0) };
    latencyRngs.set(testbed, entry);
  }
  return entry.rng.int(LATENCY_MS.min, LATENCY_MS.max);
}

/** Overridable for tests. */
export const timing = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function prefsOf(testbed: Testbed, userId: number): ContactPrefsRow {
  return contactPrefsOf(testbed.db, userId) ?? { userId, ...DEFAULT_CONTACT_PREFS };
}

function unauthenticated(c: Context<Env>, action: string) {
  c.set("audit", { action, detail: { reason: "unauthenticated" } });
  return c.json({ error: "Sign in to change your preferences." }, 401);
}

export function registerPreferencesRoutes(app: Hono<Env>, testbed: Testbed): void {
  app.get("/preferences", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Sign in to see your preferences." }, 401);
    await timing.sleep(latencyFor(testbed));
    if (testbed.variant.flaky === "on" && fact(testbed.db, FLAKY_FACT) === undefined) {
      setFact(testbed.db, FLAKY_FACT, "failed");
      return c.json({ error: PREFERENCES_MESSAGES.loadFailed }, 503);
    }
    return c.json({ prefs: prefsOf(testbed, user.id) });
  });

  app.put("/preferences", async (c) => {
    const action = "prefs.update";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const body = await readJson(c.req.raw);
    await timing.sleep(latencyFor(testbed));
    const parsed = ContactPrefsInput.safeParse(body);
    if (!parsed.success) {
      c.set("audit", { action, detail: { reason: "invalid" } });
      return c.json({ error: "validation", fieldErrors: { phone: PREFERENCES_MESSAGES.invalidPhone } }, 400);
    }
    const next: ContactPrefsRow = { ...prefsOf(testbed, user.id), ...parsed.data };
    saveContactPrefs(testbed.db, next);
    c.set("audit", { action, detail: parsed.data });
    return c.json({ prefs: next, message: PREFERENCES_MESSAGES.saved });
  });

  app.post("/preferences/unsubscribe-all", async (c) => {
    const action = "prefs.unsubscribe_all";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    await timing.sleep(latencyFor(testbed));
    const next: ContactPrefsRow = { ...prefsOf(testbed, user.id), news: false, unsubscribed: true };
    saveContactPrefs(testbed.db, next);
    c.set("audit", { action, detail: {} });
    return c.json({ prefs: next, message: PREFERENCES_MESSAGES.unsubscribed });
  });

  app.get("/chrome", (c) => {
    const consent = ConsentChoice.safeParse(fact(testbed.db, CONSENT_FACT));
    let promo = null;
    if (testbed.variant.popups === "on" && fact(testbed.db, PROMO_FACT) === undefined) {
      const rng = createRng((testbed.seed ^ nameHash("promo")) >>> 0);
      const pick = rng.pick(PROMOS);
      promo = { ...pick, delayMs: rng.int(PROMO_DELAY_MS.min, PROMO_DELAY_MS.max) };
    }
    return c.json({ consent: consent.success ? consent.data : null, promo });
  });

  app.post("/consent", async (c) => {
    const parsed = ConsentChoice.safeParse((await readJson(c.req.raw)).choice);
    if (!parsed.success) {
      c.set("audit", { action: "consent.set", detail: { reason: "invalid" } });
      return c.json({ error: "Choose all or necessary cookies." }, 400);
    }
    setFact(testbed.db, CONSENT_FACT, parsed.data);
    c.set("audit", { action: "consent.set", detail: { choice: parsed.data } });
    return c.json({ consent: parsed.data });
  });

  app.post("/promo", async (c) => {
    const parsed = PromoDecision.safeParse((await readJson(c.req.raw)).decision);
    if (!parsed.success) {
      c.set("audit", { action: "promo.dismiss", detail: { reason: "invalid" } });
      return c.json({ error: "Unknown decision." }, 400);
    }
    setFact(testbed.db, PROMO_FACT, parsed.data);
    c.set("audit", { action: `promo.${parsed.data}`, detail: {} });
    return c.json({ decision: parsed.data });
  });
}
