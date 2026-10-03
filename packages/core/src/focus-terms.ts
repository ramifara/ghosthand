// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Words from the goal that name what to look for ("feed the bear" → feed, bear). On a large page the
// driver keeps at most a few hundred elements and each question head a few dozen candidates; elements
// matching these words are kept and offered first, so the one control that matters is not cut off.
import type { Element } from "@ghosthand/protocol";

const STOPWORDS = new Set(
  (
    "the and that this these those with for from into onto then than when where what which who whom whose " +
    "are was were been being have has had does did doing will would should could can may might must " +
    "you your yours our ours their them they she him her his its it's i'm me my mine we us " +
    "not but all any some each every other more most such only own same very just also too " +
    "about above after again against before below between during through under until over out off " +
    "please go goes going open opens click clicks press tap find show shows showes shown screen page site " +
    "website web google bing search seatch serach look see get make use there here it on in to of a an " +
    "is be at by or as do so up if no new"
  ).split(" "),
);

/** At most this many words; the first ones in the goal win. */
export const MAX_FOCUS_TERMS = 12;

/** Lower-case content words (3+ letters) of the goal and instruction, without stopwords or duplicates. */
export function focusTerms(...texts: string[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const raw of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []) {
      const word = raw.replace(/'s$/, "");
      if (word.length < 3 || STOPWORDS.has(word) || /^\d+$/.test(word) || out.includes(word)) continue;
      out.push(word);
      if (out.length >= MAX_FOCUS_TERMS) return out;
    }
  }
  return out;
}

/** How many focus terms an element's name or row context contains. */
export function focusHits(el: Pick<Element, "name" | "context">, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const text = `${el.name} ${el.context ?? ""}`.toLowerCase();
  let hits = 0;
  for (const t of terms) if (text.includes(t)) hits++;
  return hits;
}
