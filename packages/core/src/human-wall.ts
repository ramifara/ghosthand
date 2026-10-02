// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Detects pages that require a human by design: CAPTCHAs, "verify you're human" interstitials and
// phone/identity verification. GhostHand never tries to get past these; it hands them to the person
// watching (desktop takeover) or ends the run at once with the reason, instead of spending model calls.
import type { Snapshot } from "@ghosthand/protocol";

const WALLS: Array<[string, RegExp]> = [
  [
    "captcha",
    /\b(?:complete|solve|finish|enter|answer)\s+(?:(?:the|this|a)\s+)?(?:re)?captcha\b|\b(?:reCAPTCHA|hCAPTCHA|Turnstile|Arkose|FunCaptcha)\s+(?:challenge|verification|required)\b(?!\s+(?:succeeded|passed|completed?|solved|successful))/i,
  ],
  [
    "human check",
    /verify (that )?you('| a)?re (a )?human|are you a robot|i'?m not a robot|confirm you('| a)?re (a )?human|unusual traffic/i,
  ],
  // Phone/SMS only: email codes, magic links and TOTP are handled by the agent with task credentials.
  [
    "phone verification",
    /verify your (phone|mobile)( number)?|we (texted|sent an? (sms|text))|sent a code to your (phone|mobile)|confirm your (phone|mobile) number|add (a )?(phone|mobile) number to continue/i,
  ],
];

export interface HumanWall {
  kind: string;
  /** The text or element that matched, trimmed. */
  evidence: string;
}

export function detectHumanWall(snapshot: Snapshot): HumanWall | undefined {
  // Links and frame URLs mention vendors on normal pages too. Only visible instructions and
  // actionable challenge controls count; an attribution footer must not stop a login or QA run.
  const completed = snapshot.elements.filter((e) => e.role === "checkbox" && e.states.includes("checked"));
  const controls = snapshot.elements.filter(
    (e) => e.role !== "link" && !e.states.includes("disabled") && !completed.includes(e),
  );
  const withoutCompleted = (text: string) =>
    completed.reduce((value, e) => (e.name ? value.replaceAll(e.name, "") : value), text);
  const texts = [snapshot.title, withoutCompleted(snapshot.text), ...controls.map((e) => e.name)];
  for (const [kind, re] of WALLS) {
    for (const t of texts) {
      const m = re.exec(t);
      if (m)
        return {
          kind,
          evidence: t
            .slice(Math.max(0, m.index - 40), m.index + 80)
            .replace(/\s+/g, " ")
            .trim(),
        };
    }
  }
  const captchaControl = controls.find(
    (e) =>
      ["checkbox", "button"].includes(e.role) &&
      /^(?:reCAPTCHA|hCAPTCHA|CAPTCHA|Turnstile|Arkose|FunCaptcha)$/i.test(e.name.trim()),
  );
  if (captchaControl) return { kind: "captcha", evidence: captchaControl.name };
  return undefined;
}
