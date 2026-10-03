// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Finite text options for set_value: literals quoted or embedded in the goal, plus secret names.
// Free-text generation is the writer's job (Phase 1); Jev only chooses among these. Goals are often
// written without quotes ("search for a vegan restaurant in berlin", "log in with me@x.com hunter2!"),
// so the phrases a person would type are pulled out of the usual wordings too.
import { type SecretsRegistry, secretPlaceholder } from "./secrets.ts";

export type TextOption =
  | { key: string; kind: "literal"; text: string }
  | { key: string; kind: "secret"; name: string };

const QUOTED = /"([^"\n]{1,200})"|“([^”\n]{1,200})”|'([^'\n]{2,200})'|`([^`\n]{1,200})`/g;
/** ISO dates and times, money and percentages are single literals (never split into numbers). */
const DATE = /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
const MONEY = /[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?(?:%|\s?(?:USD|EUR|GBP)\b)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_LIKE = /\bhttps?:\/\/\S+|\bwww\.\S+/g;
const NUMBER = /(?<![\w.])[+-]?\d[\d,.]*\d(?![\w])|(?<![\w.])\d(?![\w.])/g;
const AFTER_TO = /\bto\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})/g;

/** Where a phrase ends: a clause joiner, punctuation, or "on google"-style destinations. */
const END = String.raw`(?=\s+(?:and|then|after|before|so|to\s+(?:find|see|get|open|check)|on\s+(?:google|the\s+(?:web|internet|page|site)|maps|amazon|youtube)|in\s+google|using|via|from\s+the)\b|\s*[,;!?\n]|\.(?:\s|$)|$)`;
/** A typed phrase never starts with a joiner or names the field itself ("the search box"). */
const START = String.raw`(?!(?:and|then|do|to|for|or|in|on|at|it|is)\b|(?:the\s+)?(?:box|bar|field|button|results?|icon|input|maps)\b)`;
const PHRASE = String.raw`${START}([\w"'$€£#@][^\n]{0,79}?)`;
/** Searching, including common misspellings of "search". */
const SEARCH_VERB = String.raw`\b(?:search|serach|seach|saerch|seatch|sarch|searh|look\s+up|lookup|look\s+for|google)`;
const SEARCH = new RegExp(
  String.raw`${SEARCH_VERB}(?:\s+(?:on\s+)?(?:google|maps|the\s+web|the\s+site))?(?:\s+for)?\s+${PHRASE}${END}`,
  "gi",
);
/** "do a jev search", "do a quick vegan pizza search". */
const DO_SEARCH = new RegExp(
  String.raw`\bdo\s+(?:a\s+)?(?:simple\s+|quick\s+|google\s+)?${START}([\w-]+(?:\s+[\w-]+){0,3}?)\s+search\b`,
  "gi",
);
const TYPE_VERB = new RegExp(
  String.raw`\b(?:type|enter|write|input|paste|fill\s+in)\s+${PHRASE}(?=\s+(?:in|into|as|on|for)\s|${END.slice(3, -1)})`,
  "gi",
);
const SET_TO = new RegExp(
  String.raw`\b(?:set|change|rename|update)\s+(?:the\s+|your\s+|its\s+|my\s+)?[\w -]{1,30}?\s+to\s+${PHRASE}${END}`,
  "gi",
);
const WITH_TEXT = new RegExp(
  String.raw`\b(?:with|saying|says|reading)\s+(?:the\s+)?(?:text|message|comment|note|title|subject|name|value|words?)\s*:?\s+${START}([\w"'$€£#@][^\n]{0,119}?)${END}`,
  "gi",
);
/** `Password: hunter2` lines in a brief. Only labels of form fields, so prose headings are not offered. */
const LABELED =
  /^[ \t]*(?:[-*][ \t]+)?(?:\*\*)?(e-?mail|mail|user(?:\s?name)?|login|password|passwort|pass|pw|pin|code|otp|phone|tel(?:ephone)?|(?:first |last |full )?name|company|address|street|city|zip|postcode|search|query|url|website|title|subject)(?:\*\*)?[ \t]*[:=][ \t]*(?:\*\*)?(.{1,120}?)(?:\*\*)?[ \t]*$/gim;
/** A space-free token that may be a password; `isCredential` decides. Markdown emphasis is not part of it. */
const CREDENTIAL = /(?<![^\s(["'`])(?![*_])[^\s"'`,;]{8,66}(?<![*_])(?![^\s)"'`,;])/g;

/** At least 8 characters mixing three of: lower case, upper case, digits, symbols (`hunter2!`, `s3cret-Pw9`). */
function isCredential(token: string): boolean {
  if (token.length < 8 || !/[A-Za-z]/.test(token) || /^[\d.,:/-]+$/.test(token)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((re) => re.test(token)).length;
  return classes >= 3;
}
/(?<![^\s(["'`])(?![*_])(?=[^\s]*[A-Za-z])(?=[^\s]*[\d@#$%^&!?_+=~])[^\s"'`]{6,64}(?<![*_])(?![^\s)"'`,;])/g;
/** Capitalised names in mid-sentence ("search for Jev", "assign it to Mira Varga"). */
const PROPER = /(?<=[a-z,]\s+)([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})/g;

export const MAX_TEXT_OPTIONS = 40;

/** Lower rank wins a place when there are more candidates than MAX_TEXT_OPTIONS. */
interface Found {
  at: number;
  text: string;
  rank: number;
}

const ARTICLE = /^(?:a|an|the|some)\s+/i;
const CLEAN_EDGES = /^[\s"'`*“”]+|[\s"'`*“”:]+$/g;

function cleanPhrase(raw: string): string | undefined {
  const text = raw.replace(CLEAN_EDGES, "").replace(ARTICLE, "").replace(/\s+/g, " ").trim();
  if (text.length < 1 || !/[\p{L}\p{N}]/u.test(text)) return undefined;
  return text;
}

/** `[input:NAME]` placeholders stand for stored secrets, offered by name; never as text to type. */
const PLACEHOLDER = /\[input:[A-Za-z0-9_]+\]/g;

/** Extracts candidate literals in order of appearance, deduplicated. */
export function extractLiterals(rawGoal: string): string[] {
  const goal = rawGoal.replace(PLACEHOLDER, (s) => " ".repeat(s.length));
  const found: Found[] = [];
  const add = (at: number, text: string | undefined, rank: number) => {
    if (text) found.push({ at, text, rank });
  };
  for (const m of goal.matchAll(QUOTED)) add(m.index ?? 0, m[1] ?? m[2] ?? m[3] ?? m[4], 0);
  let unquoted = goal.replace(QUOTED, (s) => " ".repeat(s.length));
  // Labeled values ("Password: x") before anything splits them.
  for (const m of unquoted.matchAll(LABELED)) add(m.index ?? 0, cleanPhrase(m[2] ?? ""), 1);
  // Whole-token literals first, then blank them so NUMBER and CREDENTIAL do not split them.
  for (const [re, rank] of [
    [DATE, 3],
    [MONEY, 3],
    [EMAIL, 1],
  ] as const) {
    for (const m of unquoted.matchAll(re)) add(m.index ?? 0, m[0].trim(), rank);
    unquoted = unquoted.replace(re, (s) => " ".repeat(s.length));
  }
  // Typed phrases ("search for x", "type x into", "set y to x"), never from inside quotes.
  for (const re of [SEARCH, DO_SEARCH, TYPE_VERB, SET_TO, WITH_TEXT]) {
    for (const m of unquoted.matchAll(re)) add(m.index ?? 0, cleanPhrase(m[1] ?? ""), 2);
  }
  const noUrls = unquoted.replace(URL_LIKE, (s) => " ".repeat(s.length));
  for (const m of noUrls.matchAll(CREDENTIAL)) {
    // Brackets and a sentence's closing mark wrap the token ("(Salamatly", "Password:", "hunter2!.").
    const token = m[0].replace(/^[([{]+/, "").replace(/[.:)\]}]+$/, "");
    if (isCredential(token)) add(m.index ?? 0, token, 2);
  }
  for (const m of unquoted.matchAll(NUMBER)) add(m.index ?? 0, m[0].trim(), 4);
  for (const re of [AFTER_TO, PROPER]) {
    for (const m of unquoted.matchAll(re)) add(m.index ?? 0, (m[1] ?? m[0]).trim(), 5);
  }

  // Deduplicate (first appearance, best rank), keep the best-ranked when over the cap, then order by position.
  const byText = new Map<string, Found>();
  for (const f of found) {
    const prev = byText.get(f.text);
    if (!prev) byText.set(f.text, f);
    else byText.set(f.text, { text: f.text, at: Math.min(prev.at, f.at), rank: Math.min(prev.rank, f.rank) });
  }
  const unique = [...byText.values()].map((f, i) => ({ ...f, i }));
  const kept =
    unique.length > MAX_TEXT_OPTIONS
      ? unique.sort((a, b) => a.rank - b.rank || a.at - b.at || a.i - b.i).slice(0, MAX_TEXT_OPTIONS)
      : unique;
  return kept.sort((a, b) => a.at - b.at || a.i - b.i).map((f) => f.text);
}

export function buildTextOptions(
  goal: string,
  secretNames: string[],
  registry?: SecretsRegistry,
): TextOption[] {
  const options: TextOption[] = [];
  let i = 0;
  for (const text of extractLiterals(goal)) {
    const secret = registry?.match(text);
    if (secret) continue; // never offer a secret as a literal
    options.push({ key: `lit_${++i}`, kind: "literal", text });
  }
  // Keys must not contain the secret name: key-based log redaction would treat them as sensitive.
  secretNames.forEach((name, j) => {
    options.push({ key: `sec_${j + 1}`, kind: "secret", name });
  });
  return options;
}

export const describeTextOption = (o: TextOption): string =>
  o.kind === "literal"
    ? `Type the text: ${JSON.stringify(o.text)}`
    : `Type the stored secret ${secretPlaceholder(o.name)}`;
