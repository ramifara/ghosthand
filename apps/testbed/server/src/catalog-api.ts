// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// P1-06/P1-09 fixture routes: the oversized catalog (pickup store, cart) and the product reviews.
import {
  CATALOG_MESSAGES,
  CATALOG_PRODUCTS,
  CartAddInput,
  CatalogStoreInput,
  findProduct,
  PICKUP_STORES,
  REVIEWS,
} from "@ghosthand/testbed-kit";
import type { Context, Hono } from "hono";
import type { Env } from "./audit-middleware.ts";
import { readJson } from "./read-json.ts";
import type { Testbed } from "./testbed.ts";

function unauthenticated(c: Context<Env>, action: string) {
  c.set("audit", { action, detail: { reason: "unauthenticated" } });
  return c.json({ error: "Sign in to use the catalog." }, 401);
}

export function registerCatalogRoutes(app: Hono<Env>, testbed: Testbed): void {
  const summary = (userId: number) => {
    const store = testbed.pickupStores().find((p) => p.userId === userId)?.store ?? null;
    const cart = testbed.cart(userId);
    return { store, cartCount: cart.reduce((n, c) => n + c.quantity, 0) };
  };

  app.get("/catalog", (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Sign in to see the catalog." }, 401);
    return c.json({ products: CATALOG_PRODUCTS, stores: PICKUP_STORES, ...summary(user.id) });
  });

  app.post("/catalog/store", async (c) => {
    const action = "catalog.store";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const parsed = CatalogStoreInput.safeParse(await readJson(c.req.raw));
    if (!parsed.success || !PICKUP_STORES.includes(parsed.data.store)) {
      c.set("audit", { action, detail: { reason: "unknown_store" } });
      return c.json({ error: "Choose a store from the list." }, 400);
    }
    testbed.db
      .query(
        "insert into pickup_stores (user_id, store) values ($id, $store) on conflict(user_id) do update set store = excluded.store",
      )
      .run({ id: user.id, store: parsed.data.store });
    c.set("audit", { action, detail: { store: parsed.data.store } });
    return c.json({ ...summary(user.id), message: CATALOG_MESSAGES.storeSaved(parsed.data.store) });
  });

  app.post("/cart", async (c) => {
    const action = "cart.add";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const parsed = CartAddInput.safeParse(await readJson(c.req.raw));
    const product = parsed.success ? findProduct(parsed.data.productId) : undefined;
    if (!product) {
      c.set("audit", { action, detail: { reason: "unknown_product" } });
      return c.json({ error: "That product does not exist." }, 404);
    }
    testbed.db
      .query(
        `insert into cart_items (user_id, product_id, quantity) values ($id, $product, 1)
         on conflict(user_id, product_id) do update set quantity = quantity + 1`,
      )
      .run({ id: user.id, product: product.id });
    c.set("audit", { action, detail: { productId: product.id } });
    return c.json({ ...summary(user.id), message: CATALOG_MESSAGES.added(product.name) });
  });

  app.get("/reviews", (c) => {
    if (!c.get("user")) return c.json({ error: "Sign in to read reviews." }, 401);
    return c.json({ reviews: REVIEWS });
  });
}
