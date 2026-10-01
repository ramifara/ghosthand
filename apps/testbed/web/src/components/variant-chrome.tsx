// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L6 page-wide variants: theme, zoom and text direction on <html>, plus (with `popups: "on"`) a cookie banner
// fixed to the bottom of the viewport and a seeded promo modal that opens after a delay and blocks the page.
// With no L6 flag set this renders nothing and leaves the document untouched.
import {
  type Chrome,
  COOKIE_BANNER,
  type ConsentChoice,
  PROMO_DISMISS,
  type PromoDecision,
} from "@ghosthand/testbed-kit/preferences";
import "../variant-themes.css";
import { useEffect, useLayoutEffect, useState } from "react";
import { authApi } from "../lib/auth-api.ts";
import { tid } from "../lib/tid.ts";
import { activeVariant } from "../lib/variant.ts";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

function useDocumentVariant(): void {
  const { theme, zoom, locale } = activeVariant();
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme && theme !== "system") root.dataset.theme = theme;
    if (zoom && zoom !== "100") root.dataset.zoom = zoom;
    if (locale === "ar") {
      root.dir = "rtl";
      root.lang = "ar";
    }
    return () => {
      delete root.dataset.theme;
      delete root.dataset.zoom;
      root.removeAttribute("dir");
      root.lang = "en";
    };
  }, [theme, zoom, locale]);
}

export function VariantChrome() {
  useDocumentVariant();
  return activeVariant().popups === "on" ? <Popups /> : null;
}

function Popups() {
  const [chrome, setChrome] = useState<Chrome | undefined>(undefined);
  const [promoOpen, setPromoOpen] = useState(false);

  useEffect(() => {
    void authApi.chrome().then((res) => {
      if (res.ok) setChrome(res.value);
    });
  }, []);

  const promo = chrome?.promo;
  useEffect(() => {
    if (!promo) return;
    const timer = setTimeout(() => setPromoOpen(true), promo.delayMs);
    return () => clearTimeout(timer);
  }, [promo]);

  async function choose(choice: ConsentChoice) {
    const res = await authApi.setConsent(choice);
    if (res.ok) setChrome((c) => (c ? { ...c, consent: res.value.consent } : c));
  }

  async function decide(decision: PromoDecision) {
    setPromoOpen(false);
    setChrome((c) => (c ? { ...c, promo: null } : c));
    await authApi.decidePromo(decision);
  }

  return (
    <>
      {chrome && chrome.consent === null ? (
        <section
          aria-labelledby="cookie-banner-title"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-panel shadow-[0_-4px_16px_rgba(0,0,0,0.12)]"
          {...tid("cookies.banner")}
        >
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-4">
            <div className="min-w-64 flex-1">
              <h2 id="cookie-banner-title" className="text-sm font-semibold">
                {COOKIE_BANNER.title}
              </h2>
              <p className="text-sm text-muted">{COOKIE_BANNER.body}</p>
            </div>
            <Button variant="outline" onClick={() => void choose("necessary")} {...tid("cookies.reject")}>
              {COOKIE_BANNER.reject}
            </Button>
            <Button onClick={() => void choose("all")} {...tid("cookies.accept")}>
              {COOKIE_BANNER.acceptAll}
            </Button>
          </div>
        </section>
      ) : null}
      {promo ? (
        <Dialog
          open={promoOpen}
          onOpenChange={(open) => {
            if (!open) void decide("dismiss");
          }}
        >
          <DialogContent aria-describedby="promo-description" {...tid("promo.dialog")}>
            <DialogHeader>
              <DialogTitle>{promo.headline}</DialogTitle>
              <DialogDescription id="promo-description">
                Limited-time offer for testbed members.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <p className="text-sm">Unlock unlimited orders, reports and priority support.</p>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => void decide("dismiss")} {...tid("promo.dismiss")}>
                {PROMO_DISMISS}
              </Button>
              <Button onClick={() => void decide("accept")} {...tid("promo.accept")}>
                {promo.cta}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
