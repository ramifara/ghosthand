// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 virtualized list: 200 SKUs in a fixed-height scroll container. Only the rows near the scroll position
// are in the DOM; each row says where it sits (aria-posinset / aria-setsize).
import { useEffect, useState } from "react";
import { LabPage, type LabStatus, LabStatusLine } from "../components/lab-page.tsx";
import { Button } from "../components/ui/button.tsx";
import { type LabSku, labApi } from "../lib/lab-api.ts";
import { tid } from "../lib/tid.ts";

const ROW = 44;
const VIEW = 396;
const OVERSCAN = 2;

export function LabInventoryPage() {
  return (
    <LabPage
      title="Inventory"
      description="Every SKU in the warehouse. Mark SKUs you no longer sell as discontinued."
      what="see the inventory"
    >
      {() => <Inventory />}
    </LabPage>
  );
}

function Inventory() {
  const [skus, setSkus] = useState<LabSku[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [status, setStatus] = useState<LabStatus>(undefined);

  useEffect(() => {
    void labApi.inventory().then((res) => {
      if (res.ok) setSkus(res.value.skus);
      else setStatus({ ok: false, text: res.message });
    });
  }, []);

  async function discontinue(sku: LabSku) {
    const res = await labApi.discontinue(sku.id);
    if (!res.ok) return setStatus({ ok: false, text: res.message });
    setSkus((all) => all.map((s) => (s.id === sku.id ? { ...s, discontinued: true } : s)));
    setStatus({ ok: true, text: res.value.message });
  }

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(skus.length, Math.ceil((scrollTop + VIEW) / ROW) + OVERSCAN);
  const visible = skus.slice(first, last);

  return (
    <div className="max-w-xl space-y-3">
      <LabStatusLine status={status} />
      <p className="text-xs text-muted">{`${skus.length} SKUs`}</p>
      {/* biome-ignore lint/a11y/useSemanticElements: rows are absolutely positioned inside a spacer, so ul/li do not fit. */}
      <div
        role="list"
        aria-label="Inventory"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the scroll container is keyboard-scrollable.
        tabIndex={0}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="relative overflow-y-auto rounded-md border border-border bg-panel"
        style={{ height: VIEW }}
        {...tid("inventory.list")}
      >
        <div style={{ height: skus.length * ROW }} className="relative">
          {visible.map((sku, i) => (
            // biome-ignore lint/a11y/useSemanticElements: see the list above.
            <div
              key={sku.id}
              role="listitem"
              aria-posinset={first + i + 1}
              aria-setsize={skus.length}
              className="absolute inset-x-0 flex items-center gap-3 border-b border-border/60 px-3"
              style={{ top: (first + i) * ROW, height: ROW }}
            >
              <span className="w-20 font-mono text-xs">{sku.id}</span>
              <span className="flex-1 text-sm">{sku.name}</span>
              <span className="w-20 text-right text-xs text-muted">{`${sku.stock} in stock`}</span>
              {sku.discontinued ? (
                <span className="w-28 text-right text-xs font-medium text-bad">Discontinued</span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-28"
                  aria-label={`Discontinue ${sku.id}`}
                  onClick={() => void discontinue(sku)}
                  {...tid(`inventory.discontinue.${sku.id}`)}
                >
                  Discontinue
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
