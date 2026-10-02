// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Detects pages that require a human by design: CAPTCHAs, "verify you're human" interstitials and
// phone/identity verification. GhostHand never tries to get past these; it hands them to the person
// watching (desktop takeover) or ends the run at once with the reason, instead of spending model calls.
import type { Snapshot } from "@ghosthand/protocol";

const WALLS: Array<[string, RegExp]> = [
  ["captcha", /\b(re)?captcha\b|hcaptcha|turnstile|arkose|funcaptcha/i],
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
  const texts = [
    snapshot.title,
    snapshot.text,
    ...snapshot.elements.flatMap((e) => [e.name, e.frame, e.href ?? ""]),
  ];
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
  return undefined;
}
