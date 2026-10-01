// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 shadow DOM: notification preferences in an open shadow root, a promo box in a closed one.
import { useEffect, useRef, useState } from "react";
import { defineNotifyPrefsElement, NOTIFY_PREFS_TAG } from "../components/lab-notify-prefs-element.ts";
import { LabPage } from "../components/lab-page.tsx";
import { definePromoBoxElement, PROMO_BOX_TAG } from "../components/lab-promo-box-element.ts";
import { labApi } from "../lib/lab-api.ts";
import { tid } from "../lib/tid.ts";

/** Mounts a custom element into a host div (keeps JSX free of custom-element typings). */
function CustomElementHost({ tag, onEvent }: { tag: string; onEvent?: (e: Event) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = document.createElement(tag);
    if (onEvent) el.addEventListener("promo-applied", onEvent);
    host.current?.append(el);
    return () => el.remove();
  }, [tag, onEvent]);
  return <div ref={host} />;
}

export function LabPreferencesPage() {
  defineNotifyPrefsElement();
  return (
    <LabPage
      title="Notification preferences"
      description="Choose when the email digest goes out and whether you get the weekly summary."
      what="change notification preferences"
    >
      {() => <CustomElementHost tag={NOTIFY_PREFS_TAG} />}
    </LabPage>
  );
}

export function LabPromoPage() {
  definePromoBoxElement();
  return (
    <LabPage title="Promo" description="Apply a promo code to your next order." what="apply promo codes">
      {() => <PromoView />}
    </LabPage>
  );
}

function PromoView() {
  const [codes, setCodes] = useState<string[] | undefined>(undefined);
  useEffect(() => {
    void labApi.promo().then((res) => setCodes(res.ok ? res.value.codes : []));
  }, []);
  const [onApplied] = useState(() => (e: Event) => {
    const code = (e as CustomEvent<string>).detail;
    setCodes((all) => (all?.includes(code) ? all : [...(all ?? []), code]));
  });
  return (
    <div className="space-y-3">
      <CustomElementHost tag={PROMO_BOX_TAG} onEvent={onApplied} />
      <p className="text-sm" {...tid("promo.applied")}>
        {codes === undefined
          ? "Loading…"
          : codes.length === 0
            ? "No promo code applied yet."
            : `Applied codes: ${codes.join(", ")}`}
      </p>
    </div>
  );
}
