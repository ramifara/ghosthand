// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Thin client for the app API under /api (same origin, cookie session).
import {
  CustomerRow,
  type OrderPatch,
  OrderRow,
  type OrderStatus,
  type OrdersQuery,
} from "@ghosthand/testbed-kit/orders";
import type { FieldErrors, ProfileInput } from "@ghosthand/testbed-kit/profile-schema";
import { Review } from "@ghosthand/testbed-kit/reviews";
import { MailRow, UserRow } from "@ghosthand/testbed-kit/schemas";
import {
  type GeneralSettingsInput,
  type NotificationSettingsInput,
  SettingsRow,
} from "@ghosthand/testbed-kit/settings";
import { Variant } from "@ghosthand/testbed-kit/variant";
import { z } from "zod";

export type User = UserRow;
export type Mail = MailRow;

const Config = z.object({ variant: Variant, resetId: z.number(), now: z.string() });
export type Config = z.infer<typeof Config>;
const Home = z.object({ buildCode: z.string(), releaseName: z.string(), openTickets: z.number() });
export type Home = z.infer<typeof Home>;
const Me = z.object({ user: UserRow.nullable() });
const ErrorBody = z.object({
  error: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
});

export type Order = OrderRow;
export type Customer = CustomerRow;
const OrdersPage = z.object({
  orders: z.array(OrderRow),
  total: z.number(),
  page: z.number(),
  pageCount: z.number(),
  pageSize: z.number(),
});
export type OrdersPage = z.infer<typeof OrdersPage>;
const OrderSaved = z.object({ order: OrderRow, message: z.string() });
const Revenue = z.object({ from: z.string(), to: z.string(), count: z.number(), totalCents: z.number() });
export type Revenue = z.infer<typeof Revenue>;
const SettingsResponse = z.object({
  settings: SettingsRow,
  apiKeyPreview: z.string(),
  message: z.string().optional(),
});
export type SettingsResponse = z.infer<typeof SettingsResponse>;

const CatalogProduct = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  priceCents: z.number(),
});
export type CatalogProduct = z.infer<typeof CatalogProduct>;
const CatalogSummary = z.object({ store: z.string().nullable(), cartCount: z.number() });
const Catalog = CatalogSummary.extend({ products: z.array(CatalogProduct), stores: z.array(z.string()) });
export type Catalog = z.infer<typeof Catalog>;
const CatalogChanged = CatalogSummary.extend({ message: z.string() });
export type ReviewItem = Review;
const Message = z.object({ message: z.string() });

function ordersSearch(query: OrdersQuery): string {
  const params = new URLSearchParams({ page: String(query.page), sort: query.sort, dir: query.dir });
  if (query.status) params.set("status", query.status);
  if (query.q) params.set("q", query.q);
  return params.toString();
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; message: string; fieldErrors?: FieldErrors };

async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  init?: { method: string; body?: unknown },
): Promise<ApiResult<z.infer<S>>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      credentials: "same-origin",
      ...(init?.body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
    });
  } catch {
    return { ok: false, message: "The server could not be reached. Try again." };
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ErrorBody.safeParse(json);
    if (!parsed.success) return { ok: false, message: `Request failed (${res.status}).` };
    return parsed.data.fieldErrors
      ? { ok: false, message: parsed.data.error, fieldErrors: parsed.data.fieldErrors as FieldErrors }
      : { ok: false, message: parsed.data.error };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: "Unexpected server response." };
}

export const api = {
  config: () => request(Config, "/api/config"),
  home: () => request(Home, "/api/home"),
  me: () => request(Me, "/api/me"),
  login: (email: string, password: string) =>
    request(z.object({ user: UserRow }), "/api/login", { method: "POST", body: { email, password } }),
  logout: () => request(z.object({ ok: z.boolean() }), "/api/logout", { method: "POST", body: {} }),
  updateProfile: (profile: ProfileInput) =>
    request(z.object({ user: UserRow, message: z.string() }), "/api/profile", {
      method: "PUT",
      body: profile,
    }),
  mail: () => request(z.object({ messages: z.array(MailRow) }), "/api/mail"),
  orders: (query: OrdersQuery) => request(OrdersPage, `/api/orders?${ordersSearch(query)}`),
  updateOrder: (id: string, patch: OrderPatch) =>
    request(OrderSaved, `/api/orders/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),
  saveNote: (id: string, note: string) =>
    request(OrderSaved, `/api/orders/${encodeURIComponent(id)}/note`, { method: "PUT", body: { note } }),
  deleteOrder: (id: string) =>
    request(z.object({ id: z.string(), message: z.string() }), `/api/orders/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: { confirmed: true },
    }),
  restoreOrder: (id: string) =>
    request(OrderSaved, `/api/orders/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      body: { via: "toast" },
    }),
  bulkStatus: (ids: string[], status: OrderStatus) =>
    request(z.object({ changed: z.array(z.string()), message: z.string() }), "/api/orders/bulk-status", {
      method: "POST",
      body: { ids, status },
    }),
  customers: (q: string) =>
    request(z.object({ customers: z.array(CustomerRow) }), `/api/customers?q=${encodeURIComponent(q)}`),
  revenue: (from: string, to: string) =>
    request(Revenue, `/api/reports/revenue?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  settings: () => request(SettingsResponse, "/api/settings"),
  saveGeneral: (input: GeneralSettingsInput) =>
    request(SettingsResponse, "/api/settings/general", { method: "PUT", body: input }),
  saveNotifications: (input: NotificationSettingsInput) =>
    request(SettingsResponse, "/api/settings/notifications", { method: "PUT", body: input }),
  rotateWebhookSecret: () =>
    request(SettingsResponse, "/api/settings/webhook-secret/rotate", { method: "POST", body: {} }),
  revokeApiKey: () => request(SettingsResponse, "/api/settings/api-key/revoke", { method: "POST", body: {} }),
  catalog: () => request(Catalog, "/api/catalog"),
  saveStore: (store: string) =>
    request(CatalogChanged, "/api/catalog/store", { method: "POST", body: { store } }),
  addToCart: (productId: string) =>
    request(CatalogChanged, "/api/cart", { method: "POST", body: { productId } }),
  reviews: () => request(z.object({ reviews: z.array(Review) }), "/api/reviews"),
  changePassword: (current: string, next: string, confirm: string) =>
    request(Message, "/api/account/password", { method: "POST", body: { current, next, confirm } }),
  exportAccount: () => request(Message, "/api/account/export", { method: "POST", body: {} }),
  bio: () => request(z.object({ html: z.string() }), "/api/bio"),
  saveBio: (html: string) =>
    request(z.object({ html: z.string(), message: z.string() }), "/api/bio", {
      method: "PUT",
      body: { html },
    }),
};
