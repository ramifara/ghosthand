// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Cookie consent banners (ADR 0014): when the goal is not about cookies, the code presses the banner's
// "reject" choice once per screen instead of asking Jev, which splits between "Accept all" and
// "Reject all" (both move on) and gets refused by the target-confidence gate.
import type { Element, Snapshot } from "@ghosthand/protocol";

/** Text that marks a consent banner or page. */
const CONSENT_TEXT =
  /\bcookies?\b|\bconsent\b|before you continue|datenschutz|einwillig|zustimm|consentement|consentimiento|consenso|toestemming/i;

/** The least-permissive choice in the common languages, as the whole button name. */
const REJECT =
  /^(?:reject|reject all|reject all cookies|reject cookies|reject optional cookies|reject non-essential cookies|decline|decline all|decline cookies|decline optional cookies|deny|deny all|refuse all|necessary only|only necessary|only necessary cookies|use necessary cookies only|allow necessary cookies only|accept necessary cookies only|accept only necessary|essential only|only essential|essential cookies only|strictly necessary only|continue without accepting|alle ablehnen|ablehnen|nur notwendige|nur notwendige cookies|nur erforderliche|nur erforderliche cookies|nur essenzielle cookies|optionale cookies ablehnen|tout refuser|refuser|refuser tout|continuer sans accepter|rechazar|rechazar todo|rechazar todas|rifiuta|rifiuta tutto|rifiuta tutti|alles weigeren|weigeren|odrzuć wszystkie|avvisa alla|afvis alle|recusar tudo|rejeitar tudo)$/i;

/** Goals that are about consent itself are left to Jev. */
const GOAL_ABOUT_CONSENT = /\bcookies?\b|\bconsent\b|\bprivacy\b|\bgdpr\b|\btracking\b/i;

/**
 * The banner's reject button when the page shows a cookie consent choice and the goal is not about it;
 * undefined otherwise. Requires a visible accept-type button next to it, so a lone "Decline" in a form
 * (an invitation, a payment) is never pressed.
 */
export function consentRejectButton(snapshot: Snapshot, goal: string): Element | undefined {
  if (GOAL_ABOUT_CONSENT.test(goal)) return undefined;
  const usable = snapshot.elements.filter(
    (e) =>
      (e.role === "button" || e.role === "link") &&
      e.actions.includes("press") &&
      !e.states.includes("disabled") &&
      !e.states.includes("hidden"),
  );
  const names = usable.map((e) => e.name.trim().replace(/\s+/g, " "));
  const rejects = usable.filter((_, i) => REJECT.test(names[i] ?? ""));
  if (rejects.length === 0) return undefined;
  const distinct = new Set(rejects.map((e) => e.name.trim().toLowerCase()));
  if (distinct.size !== 1) return undefined;
  const hasAccept = names.some((n) =>
    /^(?:accept|accept all|accept all cookies|accept cookies|allow all|allow all cookies|agree|i agree|alle akzeptieren|akzeptieren|alle zulassen|tout accepter|accepter|aceptar|aceptar todo|accetta|accetta tutto|alles accepteren|ok)$/i.test(
      n,
    ),
  );
  if (!hasAccept) return undefined;
  const text = [snapshot.title, snapshot.text.slice(0, 4000), ...names].join("\n");
  if (!CONSENT_TEXT.test(text)) return undefined;
  return rejects[0];
}
