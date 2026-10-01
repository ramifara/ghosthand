// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// <gh-promo-box>: a custom element whose form lives in a CLOSED shadow root (L4). Script outside the
// element (including the DOM driver) cannot reach it; a person or a vision model can still use it.
// It announces applied codes with a "promo-applied" event so the page can show them.
import { labApi } from "../lib/lab-api.ts";

export const PROMO_BOX_TAG = "gh-promo-box";

const STYLE = `
:host { display: block; font: 14px/1.4 Inter, "Segoe UI", system-ui, sans-serif; color: var(--ink, #1d1f22); }
form { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; padding: 12px; max-width: 26rem;
  border: 1px dashed var(--line, #c9c5ba); border-radius: 8px; background: var(--panel, #fff); }
.field { display: grid; gap: 2px; }
label { font-size: 12px; font-weight: 500; }
input { font: inherit; height: 32px; width: 12rem; padding: 0 8px; border-radius: 6px; border: 1px solid var(--line, #c9c5ba); }
button { font: inherit; height: 32px; border: 0; border-radius: 6px; padding: 0 12px; background: var(--accent, #0f6b5c);
  color: var(--accent-ink, #fff); }
p { flex-basis: 100%; margin: 0; font-size: 13px; min-height: 1.2em; }
`;

class PromoBoxElement extends HTMLElement {
  constructor() {
    super();
    // Closed: `this.shadowRoot` is null; only this constructor holds the root.
    const root = this.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${STYLE}</style>
<form novalidate>
  <div class="field"><label for="promo-code">Promo code</label><input id="promo-code" autocomplete="off"></div>
  <button type="submit">Apply code</button>
  <p role="status"></p>
</form>`;
    const input = root.querySelector<HTMLInputElement>("#promo-code");
    const status = root.querySelector("[role=status]");
    root.querySelector("form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      void labApi.applyPromo(input?.value ?? "").then((res) => {
        if (status) status.textContent = res.ok ? res.value.message : res.message;
        if (res.ok) this.dispatchEvent(new CustomEvent("promo-applied", { detail: res.value.code }));
      });
    });
  }
}

export function definePromoBoxElement(): void {
  if (!customElements.get(PROMO_BOX_TAG)) customElements.define(PROMO_BOX_TAG, PromoBoxElement);
}
