// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 iframes: the shipping-address widget comes from a second origin (cross-origin iframe, server-rendered
// on FRAME_ORIGIN); the gift message is a same-origin iframe of this app.
import { FRAME_ORIGIN } from "@ghosthand/testbed-kit/fixtures";
import type { ShippingRow } from "@ghosthand/testbed-kit/lab";
import { useCallback, useEffect, useState } from "react";
import { LabPage } from "../components/lab-page.tsx";
import { labApi } from "../lib/lab-api.ts";
import { tid } from "../lib/tid.ts";

export function LabCheckoutPage() {
  return (
    <LabPage
      title="Checkout"
      description="Enter where the order ships and add a gift message."
      what="check out"
    >
      {() => <Checkout />}
    </LabPage>
  );
}

function Checkout() {
  const [shipping, setShipping] = useState<ShippingRow | null | undefined>(undefined);
  const refresh = useCallback(() => {
    void labApi.checkout().then((res) => {
      if (res.ok) setShipping(res.value.shipping);
    });
  }, []);

  useEffect(() => {
    refresh();
    const onMessage = (e: MessageEvent<unknown>) => {
      const data = e.data as { type?: unknown } | null;
      if (e.origin === FRAME_ORIGIN && data?.type === "ghosthand-shipping-saved") refresh();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [refresh]);

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
      <div className="space-y-4">
        <section aria-labelledby="shipping-heading" className="rounded-lg border border-border bg-panel p-3">
          <h2 id="shipping-heading" className="mb-2 text-sm font-semibold">
            Shipping
          </h2>
          <iframe
            title="Shipping address"
            src={`${FRAME_ORIGIN}/shipping`}
            className="h-[400px] w-full rounded border border-border bg-white"
            {...tid("checkout.shipping-frame")}
          />
        </section>
        <section aria-labelledby="gift-heading" className="rounded-lg border border-border bg-panel p-3">
          <h2 id="gift-heading" className="mb-2 text-sm font-semibold">
            Gift
          </h2>
          <iframe
            title="Gift message"
            src="/lab-frames/gift-message"
            className="h-[190px] w-full rounded border border-border"
            {...tid("checkout.gift-frame")}
          />
        </section>
      </div>
      <aside
        aria-label="Order summary"
        className="h-fit rounded-lg border border-border bg-panel p-3 text-sm"
      >
        <h2 className="text-sm font-semibold">Order summary</h2>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1">
          <dt className="text-muted">Walnut Desk Lamp</dt>
          <dd className="font-mono">$89.00</dd>
          <dt className="text-muted">Shipping</dt>
          <dd className="font-mono">$7.50</dd>
        </dl>
        <p className="mt-3 text-xs text-muted" {...tid("checkout.ships-to")}>
          {shipping
            ? `Ships to ${shipping.fullName}, ${shipping.street}, ${shipping.postalCode} ${shipping.city}, ${shipping.country}`
            : shipping === null
              ? "No shipping address yet."
              : "Loading…"}
        </p>
      </aside>
    </div>
  );
}
