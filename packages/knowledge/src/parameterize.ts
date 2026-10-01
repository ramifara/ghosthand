// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Parameters (research note §2.3): literals from the instruction that a recipe typed or selected become
// `{{p1}}`, `{{p2}}`, ... in the intent template, the step values and the plan. A new instruction binds
// them back by matching the template. Secrets are never parameters: they stay names.
import type { RecipeParam } from "./recipe-schema.ts";

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The literal as a whole token (not inside a longer word or number). */
const tokenRe = (literal: string): RegExp => new RegExp(`(?<![\\w@.])${escapeRe(literal)}(?![\\w@])`, "g");

export interface Parameterized {
  intent: string;
  params: RecipeParam[];
  /** literal → placeholder, longest literal first. */
  replacements: Array<{ literal: string; placeholder: string }>;
}

/** Turns the literals used by the run (and present in the instruction) into parameters. */
export function parameterize(instruction: string, usedLiterals: readonly string[]): Parameterized {
  const unique = [...new Set(usedLiterals.filter((l) => l.trim() !== "" && tokenRe(l).test(instruction)))];
  // Longest first, so "45 items" is replaced before "45".
  unique.sort((a, b) => b.length - a.length);
  let intent = instruction;
  const params: RecipeParam[] = [];
  const replacements: Parameterized["replacements"] = [];
  for (const literal of unique) {
    const name = `p${params.length + 1}`;
    const placeholder = `{{${name}}}`;
    const next = intent.replace(tokenRe(literal), placeholder);
    if (next === intent) continue;
    intent = next;
    params.push({ name, example: literal });
    replacements.push({ literal, placeholder });
  }
  return { intent, params, replacements };
}

/** Replaces each literal by its placeholder inside a string (whole tokens only). */
export function templateString(text: string, replacements: Parameterized["replacements"]): string {
  let out = text;
  for (const { literal, placeholder } of replacements) out = out.replace(tokenRe(literal), placeholder);
  return out;
}

const normalize = (s: string): string => s.trim().replace(/\s+/g, " ");

/** Matches an instruction against an intent template; returns the bound params or undefined. */
export function bindIntent(template: string, instruction: string): Record<string, string> | undefined {
  const names: string[] = [];
  const parts = normalize(template).split(/\{\{([a-z][a-z0-9_]*)\}\}/);
  let source = "^";
  parts.forEach((part, i) => {
    if (i % 2 === 0) source += escapeRe(part);
    else if (names.includes(part)) source += `\\k<${part}>`;
    else {
      names.push(part);
      source += `(?<${part}>.+?)`;
    }
  });
  source += "$";
  let m: RegExpExecArray | null;
  try {
    m = new RegExp(source, "s").exec(normalize(instruction));
  } catch {
    return undefined;
  }
  if (!m) return undefined;
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = m.groups?.[n];
    if (v === undefined) return undefined;
    out[n] = v;
  }
  return out;
}

/** Substitutes `{{name}}` placeholders in every string of a JSON-able value. */
export function bindValue<T>(value: T, params: Record<string, string>): T {
  if (Object.keys(params).length === 0) return value;
  const sub = (s: string) => s.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (all, n: string) => params[n] ?? all);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return sub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Applies `templateString` to every string of a JSON-able value. */
export function templateValue<T>(value: T, replacements: Parameterized["replacements"]): T {
  if (replacements.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return templateString(v, replacements);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
