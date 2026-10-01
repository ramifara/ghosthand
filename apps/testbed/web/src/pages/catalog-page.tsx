// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L2 big page (P1-06): a 300-store pickup select and 1500 products in 12 named sections, far more than one
// decision request can hold. The agent has to narrow to a region and read the long select in partitions.
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { RequireSession } from "../components/require-session.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Label } from "../components/ui/label.tsx";
import { NativeSelect } from "../components/ui/select.tsx";
import { api, type Catalog, type CatalogProduct } from "../lib/api.ts";
import { tid } from "../lib/tid.ts";

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const price = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export function CatalogPage() {
  return <RequireSession what="see the catalog">{() => <CatalogView />}</RequireSession>;
}

function CatalogView() {
  const [data, setData] = useState<Catalog | undefined>(undefined);
  const [store, setStore] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | undefined>(undefined);

  useEffect(() => {
    void api.catalog().then((res) => {
      if (!res.ok) return setMessage({ ok: false, text: res.message });
      setData(res.value);
      setStore(res.value.store ?? "");
    });
  }, []);

  const categories = useMemo(() => {
    const out = new Map<string, CatalogProduct[]>();
    for (const p of data?.products ?? []) out.set(p.category, [...(out.get(p.category) ?? []), p]);
    return [...out];
  }, [data]);

  async function onSaveStore(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await api.saveStore(store);
    if (!res.ok) return setMessage({ ok: false, text: res.message });
    setData((d) => (d ? { ...d, store: res.value.store, cartCount: res.value.cartCount } : d));
    setMessage({ ok: true, text: res.value.message });
  }

  async function add(product: CatalogProduct) {
    const res = await api.addToCart(product.id);
    if (!res.ok) return setMessage({ ok: false, text: res.message });
    setData((d) => (d ? { ...d, cartCount: res.value.cartCount } : d));
    setMessage({ ok: true, text: res.value.message });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Catalog</h1>
        <p className="mt-1 text-sm text-muted" {...tid("catalog.summary")}>
          {data
            ? `${data.products.length} products · Cart: ${data.cartCount} ${data.cartCount === 1 ? "item" : "items"} · Pickup store: ${data.store ?? "not set"}`
            : "Loading…"}
        </p>
      </div>
      {message ? <Alert variant={message.ok ? "success" : "destructive"}>{message.text}</Alert> : null}
      {data ? (
        <>
          <form
            aria-label="Pickup store"
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => void onSaveStore(e)}
            {...tid("catalog.store-form")}
          >
            <div className="space-y-1">
              <Label htmlFor="pickup-store">Pickup store</Label>
              <NativeSelect
                id="pickup-store"
                value={store}
                onChange={(e) => setStore(e.target.value)}
                {...tid("catalog.store")}
              >
                <option value="">Choose a store…</option>
                {data.stores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" disabled={store === ""} {...tid("catalog.store.save")}>
              Save store
            </Button>
          </form>
          {categories.map(([category, products]) => (
            <section key={category} aria-labelledby={`cat-${slug(category)}`} className="space-y-2">
              <h2 id={`cat-${slug(category)}`} className="text-base font-semibold">
                {category}
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                {products.map((p) => (
                  <article
                    key={p.id}
                    className="product rounded-md border border-border bg-panel p-2 text-sm"
                  >
                    <p className="font-medium">{p.name}</p>
                    <p className="text-muted">{price(p.priceCents)}</p>
                    <Button size="sm" variant="outline" className="mt-1" onClick={() => void add(p)}>
                      Add to cart
                    </Button>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </>
      ) : null}
    </div>
  );
}
