// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// <gh-notify-prefs>: a custom element whose form lives in an OPEN shadow root (L4). The DOM driver can
// reach it through the shadow root; page CSS does not apply inside, so it carries its own styles.
import { DIGEST_TIMES, type DigestTime, type PrefsInput } from "@ghosthand/testbed-kit/lab";
import { labApi } from "../lib/lab-api.ts";

export const NOTIFY_PREFS_TAG = "gh-notify-prefs";

const STYLE = `
:host { display: block; font: 14px/1.4 Inter, "Segoe UI", system-ui, sans-serif; color: var(--ink, #1d1f22); }
form { display: grid; gap: 10px; max-width: 22rem; padding: 12px; border: 1px solid var(--line, #c9c5ba);
  border-radius: 8px; background: var(--panel, #fff); }
h2 { margin: 0; font-size: 14px; }
label { font-size: 12px; font-weight: 500; }
.row { display: flex; align-items: center; gap: 8px; }
select { font: inherit; height: 32px; border-radius: 6px; border: 1px solid var(--line, #c9c5ba); }
button { font: inherit; height: 32px; border: 0; border-radius: 6px; padding: 0 12px; background: var(--accent, #0f6b5c);
  color: var(--accent-ink, #fff); justify-self: start; }
[role=status] { margin: 0; font-size: 13px; color: var(--good, #1f7a3a); min-height: 1.2em; }
`;

class NotifyPrefsElement extends HTMLElement {
  readonly #root = this.attachShadow({ mode: "open" });

  connectedCallback(): void {
    if (this.#root.childElementCount > 0) return;
    const options = DIGEST_TIMES.map((t) => `<option value="${t}">${t}</option>`).join("");
    this.#root.innerHTML = `<style>${STYLE}</style>
<form aria-labelledby="prefs-title" novalidate>
  <h2 id="prefs-title">Email digest</h2>
  <div class="row"><label for="digest-at">Send digest at</label><select id="digest-at" name="digestAt">${options}</select></div>
  <div class="row"><input type="checkbox" id="weekly" name="weeklySummary"><label for="weekly">Weekly summary</label></div>
  <button type="submit">Save preferences</button>
  <p role="status"></p>
</form>`;
    const form = this.#root.querySelector("form");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.#save();
    });
    void labApi.prefs().then((res) => {
      if (res.ok) this.#show(res.value.prefs);
    });
  }

  #fields(): { digest: HTMLSelectElement | null; weekly: HTMLInputElement | null; status: Element | null } {
    return {
      digest: this.#root.querySelector<HTMLSelectElement>("#digest-at"),
      weekly: this.#root.querySelector<HTMLInputElement>("#weekly"),
      status: this.#root.querySelector("[role=status]"),
    };
  }

  #show(prefs: PrefsInput): void {
    const { digest, weekly } = this.#fields();
    if (digest) digest.value = prefs.digestAt;
    if (weekly) weekly.checked = prefs.weeklySummary;
  }

  async #save(): Promise<void> {
    const { digest, weekly, status } = this.#fields();
    const prefs: PrefsInput = {
      digestAt: (digest?.value ?? "Off") as DigestTime,
      weeklySummary: weekly?.checked ?? false,
    };
    const res = await labApi.savePrefs(prefs);
    if (status) status.textContent = res.ok ? res.value.message : res.message;
  }
}

/** Defines the element once (Vite HMR and StrictMode may call this again). */
export function defineNotifyPrefsElement(): void {
  if (!customElements.get(NOTIFY_PREFS_TAG)) customElements.define(NOTIFY_PREFS_TAG, NotifyPrefsElement);
}
