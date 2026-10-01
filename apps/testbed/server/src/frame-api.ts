// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The second origin (127.0.0.1:4402): a server-rendered shipping-address widget the checkout page embeds
// as a cross-origin iframe. It reads the testbed session cookie (cookies are per host, not per port) and
// writes to the same database, audited like the app API.
import {
  APP_ORIGIN,
  FRAME_ORIGIN,
  LAB_MESSAGES,
  SESSION_COOKIE,
  SHIPPING_COUNTRIES,
  ShippingInput,
} from "@ghosthand/testbed-kit";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { auditMiddleware, type Env } from "./audit-middleware.ts";
import { readLab } from "./lab-db.ts";
import type { Testbed } from "./testbed.ts";

type FieldName = keyof ShippingInput;
type FieldErrors = Partial<Record<FieldName, string>>;

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const FIELDS: { name: Exclude<FieldName, "country">; label: string; autocomplete: string }[] = [
  { name: "fullName", label: "Full name", autocomplete: "name" },
  { name: "street", label: "Street address", autocomplete: "street-address" },
  { name: "postalCode", label: "Postal code", autocomplete: "postal-code" },
  { name: "city", label: "City", autocomplete: "address-level2" },
];

const STYLE = `
body { font: 14px/1.4 system-ui, sans-serif; margin: 0; padding: 12px; color: #1f2933; background: #fff; }
h2 { font-size: 14px; margin: 0 0 8px; }
.field { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
label { font-size: 12px; color: #52606d; }
input, select { font: inherit; padding: 4px 6px; border: 1px solid #cbd2d9; border-radius: 4px; }
input[aria-invalid=true] { border-color: #c81e1e; }
.error { color: #c81e1e; font-size: 12px; }
.status { color: #046c4e; font-size: 13px; margin: 6px 0 0; }
button { font: inherit; padding: 4px 10px; border-radius: 4px; border: 0; background: #3b5bdb; color: #fff; }
`;

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shipping address</title>
<style>${STYLE}</style></head><body>${body}</body></html>`;
}

function shippingForm(values: Partial<ShippingInput>, errors: FieldErrors, status?: string): string {
  const fields = FIELDS.map((f) => {
    const error = errors[f.name];
    const id = `ship-${f.name}`;
    return `<div class="field"><label for="${id}">${f.label}</label>
<input id="${id}" name="${f.name}" autocomplete="${f.autocomplete}" value="${escapeHtml(values[f.name] ?? "")}"
 ${error ? `aria-invalid="true" aria-describedby="${id}-error"` : ""}>
${error ? `<span class="error" id="${id}-error">${escapeHtml(error)}</span>` : ""}</div>`;
  }).join("");
  const options = SHIPPING_COUNTRIES.map(
    (c) => `<option${values.country === c ? " selected" : ""}>${c}</option>`,
  ).join("");
  const countryError = errors.country;
  const country = `<div class="field"><label for="ship-country">Country</label>
<select id="ship-country" name="country"><option value="">Choose a country</option>${options}</select>
${countryError ? `<span class="error">${escapeHtml(countryError)}</span>` : ""}</div>`;
  const notify = status
    ? `<p class="status" role="status">${escapeHtml(status)}</p>
<script>parent.postMessage({ type: "ghosthand-shipping-saved" }, ${JSON.stringify(APP_ORIGIN)});</script>`
    : "";
  return page(`<form method="post" action="/shipping" aria-labelledby="ship-title" novalidate>
<h2 id="ship-title">Shipping address</h2>${fields}${country}
<button type="submit">Save address</button></form>${notify}`);
}

export function createFrameApi(testbed: Testbed): Hono<Env> {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    c.set("user", token ? testbed.userBySession(token) : undefined);
    // Only the testbed app may embed this widget.
    c.header("content-security-policy", `frame-ancestors ${APP_ORIGIN}`);
    c.header("cache-control", "no-store");
    await next();
  });
  app.use("*", auditMiddleware(testbed, "anonymous"));

  app.get("/health", (c) => c.json({ ok: true, origin: FRAME_ORIGIN }));

  app.get("/shipping", (c) => {
    const user = c.get("user");
    if (!user) return c.html(page('<p role="alert">Sign in to the testbed to enter a shipping address.</p>'));
    const saved = readLab(testbed.db).shipping.find((s) => s.userId === user.id);
    return c.html(shippingForm(saved ?? {}, {}));
  });

  app.post("/shipping", async (c) => {
    const action = "lab.shipping_save";
    const user = c.get("user");
    if (!user) {
      c.set("audit", { action, detail: { via: "frame", reason: "unauthenticated" } });
      return c.html(page('<p role="alert">Sign in to the testbed to enter a shipping address.</p>'), 401);
    }
    const form = await c.req.parseBody();
    const raw = Object.fromEntries(
      ["fullName", "street", "city", "postalCode", "country"].map((k) => [
        k,
        typeof form[k] === "string" ? form[k] : "",
      ]),
    ) as Record<FieldName, string>;
    const parsed = ShippingInput.safeParse(raw);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldName;
        errors[key] ??= key === "country" ? "Choose a country." : issue.message;
      }
      c.set("audit", { action, detail: { via: "frame", fieldErrors: Object.keys(errors) } });
      return c.html(shippingForm(raw as Partial<ShippingInput>, errors), 400);
    }
    const v = parsed.data;
    testbed.db
      .query(
        `insert into lab_shipping (user_id, full_name, street, city, postal_code, country)
         values ($id, $fullName, $street, $city, $postalCode, $country)
         on conflict(user_id) do update set full_name = excluded.full_name, street = excluded.street,
           city = excluded.city, postal_code = excluded.postal_code, country = excluded.country`,
      )
      .run({ id: user.id, ...v });
    c.set("audit", { action, detail: { via: "frame", country: v.country } });
    return c.html(shippingForm(v, {}, LAB_MESSAGES.shippingSaved));
  });

  app.notFound((c) => c.text("not found", 404));
  return app;
}
