// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Finite text options for set_value: literals quoted or embedded in the goal, plus secret names.
// Free-text generation is the writer's job (Phase 1); Jev only chooses among these.
import { type SecretsRegistry, secretPlaceholder } from "./secrets.ts";

export type TextOption =
  | { key: string; kind: "literal"; text: string }
  | { key: string; kind: "secret"; name: string };

const QUOTED = /"([^"\n]{1,200})"|“([^”\n]{1,200})”|'([^'\n]{2,200})'|`([^`\n]{1,200})`/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const NUMBER = /(?<![\w.])[+-]?\d[\d,.]*\d(?![\w])|(?<![\w.])\d(?![\w.])/g;
const AFTER_TO = /\bto\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})/g;

export const MAX_TEXT_OPTIONS = 40;

/** Extracts candidate literals in order of appearance, deduplicated. */
export function extractLiterals(goal: string): string[] {
  const found: Array<{ at: number; text: string }> = [];
  for (const m of goal.matchAll(QUOTED)) {
    const text = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (text) found.push({ at: m.index ?? 0, text });
  }
  const unquoted = goal.replace(QUOTED, (s) => " ".repeat(s.length));
  for (const re of [EMAIL, NUMBER, AFTER_TO]) {
    for (const m of unquoted.matchAll(re)) {
      const text = (m[1] ?? m[0]).trim();
      if (text) found.push({ at: m.index ?? 0, text });
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { text } of found.sort((a, b) => a.at - b.at)) {
    if (!seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }
  return out.slice(0, MAX_TEXT_OPTIONS);
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
