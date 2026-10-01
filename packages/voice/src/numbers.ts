// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Spoken numbers and ordinals → integers ("twenty one" → 21, "the second" → 2, "last" → -1).
// "to"/"too"/"for" count as numbers only where a number is expected (numericSlot).

const UNITS: Record<string, number> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
/** Homophones STT produces for digits in a numeric slot. */
const SLOT_HOMOPHONES: Record<string, number> = { to: 2, too: 2, for: 4, won: 1, ate: 8, tree: 3 };

const ORDINAL_UNITS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
};
const ORDINAL_TENS: Record<string, number> = {
  twentieth: 20,
  thirtieth: 30,
  fortieth: 40,
  fiftieth: 50,
};

/**
 * Parses a whole phrase as a cardinal number ("12", "twelve", "twenty one", "a hundred and five").
 * Returns undefined when any word is not part of a number.
 */
export function parseCardinal(phrase: string, numericSlot = false): number | undefined {
  const text = phrase.trim().toLowerCase().replace(/-/g, " ");
  if (/^\d+$/.test(text)) return Number(text);
  const words = text.split(/\s+/).filter((w) => w !== "and" && w !== "a");
  if (words.length === 0) return undefined;
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of words) {
    if (w in UNITS) current += UNITS[w] ?? 0;
    else if (w in TENS) current += TENS[w] ?? 0;
    else if (w === "hundred") current = (current || 1) * 100;
    else if (w === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
    } else if (numericSlot && words.length === 1 && w in SLOT_HOMOPHONES) current = SLOT_HOMOPHONES[w] ?? 0;
    else if (/^\d+$/.test(w)) current += Number(w);
    else return undefined;
    seen = true;
  }
  return seen ? total + current : undefined;
}

/** Parses an ordinal word or phrase: "second" → 2, "2nd" → 2, "twenty first" → 21, "last" → -1. */
export function parseOrdinal(phrase: string): number | undefined {
  const text = phrase.trim().toLowerCase().replace(/-/g, " ");
  if (text === "last" || text === "final") return -1;
  if (/^(second|2nd) (to )?last$/.test(text)) return -2;
  const digits = /^(\d+)(st|nd|rd|th)$/.exec(text);
  if (digits) return Number(digits[1]);
  const words = text.split(/\s+/);
  const lastWord = words[words.length - 1] ?? "";
  const unit = ORDINAL_UNITS[lastWord] ?? ORDINAL_TENS[lastWord];
  if (unit === undefined) return undefined;
  if (words.length === 1) return unit;
  if (words.length === 2) {
    const tens = TENS[words[0] ?? ""];
    if (tens !== undefined && unit < 10) return tens + unit;
  }
  return undefined;
}

/** Ordinal words, longest first, for building regexes. */
export const ORDINAL_PATTERN =
  "(?:second(?: to)? )?last|final|(?:(?:twenty|thirty|forty|fifty)[ -])?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|\\d+(?:st|nd|rd|th)";
