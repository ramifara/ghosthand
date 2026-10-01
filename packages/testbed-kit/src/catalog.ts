// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The oversized /catalog fixture (P1-06): 1500 products in 12 categories and a 300-store pickup select.
// Fully derived from constants, so the page, the server and the oracles agree without a seed. Browser-safe.
import { z } from "zod";

export const CATALOG_CATEGORIES = [
  { name: "Kitchen", nouns: ["Mug", "Cutting Board", "Bowl", "Teapot", "Spoon Rest"] },
  { name: "Garden", nouns: ["Planter", "Watering Can", "Trowel", "Bird Feeder", "Hose Reel"] },
  { name: "Office", nouns: ["Notebook", "Pen Cup", "Desk Tray", "Stapler", "Letter Rack"] },
  { name: "Bath", nouns: ["Towel", "Soap Dish", "Bath Mat", "Toothbrush Cup", "Hand Towel"] },
  { name: "Toys", nouns: ["Puzzle", "Spinning Top", "Kite", "Rocking Horse", "Yo-Yo"] },
  { name: "Books", nouns: ["Cookbook", "Field Guide", "Atlas", "Sketchbook", "Journal"] },
  { name: "Sports", nouns: ["Yoga Mat", "Water Bottle", "Jump Rope", "Kettlebell", "Gym Bag"] },
  { name: "Travel", nouns: ["Backpack", "Luggage Tag", "Packing Cube", "Neck Pillow", "Passport Wallet"] },
  { name: "Audio", nouns: ["Speaker", "Headphones", "Radio", "Turntable", "Earbuds"] },
  { name: "Lighting", nouns: ["Desk Lamp", "Floor Lamp", "Pendant Light", "Wall Light", "Lantern"] },
  { name: "Pets", nouns: ["Dog Bed", "Cat Tree", "Leash", "Feeding Bowl", "Pet Carrier"] },
  { name: "Crafts", nouns: ["Yarn Set", "Paint Kit", "Easel", "Loom", "Brush Roll"] },
] as const;

/** 25 finishes × 5 nouns = 125 unique products per category. */
const FINISHES = [
  "Walnut",
  "Oak",
  "Ash",
  "Birch",
  "Cherry",
  "Maple",
  "Brass",
  "Copper",
  "Steel",
  "Linen",
  "Wool",
  "Cotton",
  "Slate",
  "Marble",
  "Clay",
  "Glass",
  "Cork",
  "Bamboo",
  "Rattan",
  "Leather",
  "Indigo",
  "Ivory",
  "Sage",
  "Coral",
  "Amber",
] as const;

const CITIES = [
  "Aberdeen",
  "Bergen",
  "Bilbao",
  "Bologna",
  "Bordeaux",
  "Bremen",
  "Brno",
  "Cork",
  "Dresden",
  "Gdansk",
  "Ghent",
  "Graz",
  "Kraków",
  "Leipzig",
  "Lille",
  "Linz",
  "Lyon",
  "Malmö",
  "Nantes",
  "Odense",
  "Porto",
  "Riga",
  "Salzburg",
  "Seville",
  "Tampere",
  "Tartu",
  "Tromsø",
  "Turin",
  "Utrecht",
  "Valencia",
] as const;

const DISTRICTS = [
  "Central",
  "North",
  "South",
  "East",
  "West",
  "Harbour",
  "Old Town",
  "Station",
  "Airport",
  "Market",
] as const;

export interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  priceCents: number;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Every product, grouped by category in page order. */
export const CATALOG_PRODUCTS: readonly CatalogProduct[] = Object.freeze(
  CATALOG_CATEGORIES.flatMap((c, ci) =>
    FINISHES.flatMap((finish, fi) =>
      c.nouns.map((noun, ni) => ({
        id: `p-${slug(c.name)}-${fi * c.nouns.length + ni + 1}`,
        name: `${finish} ${noun}`,
        category: c.name,
        priceCents: 500 + ((ci * 37 + fi * 13 + ni * 7) % 90) * 100 + 99,
      })),
    ),
  ),
);

/** 30 cities × 10 districts = 300 pickup stores, labelled "City District". */
export const PICKUP_STORES: readonly string[] = Object.freeze(
  CITIES.flatMap((city) => DISTRICTS.map((d) => `${city} ${d}`)),
);

export function findProduct(id: string): CatalogProduct | undefined {
  return CATALOG_PRODUCTS.find((p) => p.id === id);
}

export function findProductByName(name: string): CatalogProduct | undefined {
  return CATALOG_PRODUCTS.find((p) => p.name === name);
}

export const CartItemRow = z.object({
  userId: z.number().int(),
  productId: z.string(),
  quantity: z.number().int().positive(),
});
export type CartItemRow = z.infer<typeof CartItemRow>;

export const PickupStoreRow = z.object({ userId: z.number().int(), store: z.string() });
export type PickupStoreRow = z.infer<typeof PickupStoreRow>;

export const CatalogStoreInput = z.object({ store: z.string().min(1) });
export const CartAddInput = z.object({ productId: z.string().min(1) });

export const CATALOG_MESSAGES = {
  storeSaved: (store: string) => `Pickup store saved: ${store}.`,
  added: (name: string) => `Added ${name} to your cart.`,
} as const;
