// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// i18n message tables from locale JSON files and from TS/JS object literals of strings.
import { posix } from "node:path";
import type { File } from "@babel/types";
import { collectConstants, type StaticValue } from "./static-value.ts";

export type LocaleEntry = { key: string; text: string; line: number };
export type LocaleTable = { file: string; locale?: string; entries: LocaleEntry[] };

/** Paths that hold message tables (locales/en.json, i18n/messages.ts, lang/fr/common.json). */
export const LOCALE_PATH = /(^|\/)(locales?|i18n|lang|langs|messages|translations)(\/|\.|$)/i;
const LOCALE_NAME = /^[a-z]{2,3}([-_][A-Za-z]{2,4})?$/;
const TABLE_VAR = /messages|translations|strings|locale|dictionary|i18n/i;

export function localeFromPath(file: string): string | undefined {
  const base = posix.basename(file).replace(/\.[^.]+$/, "");
  if (LOCALE_NAME.test(base)) return base;
  const dir = posix.basename(posix.dirname(file));
  return LOCALE_NAME.test(dir) ? dir : undefined;
}

function flattenJson(value: unknown, prefix: string, out: [string, string][]): void {
  if (typeof value === "string") {
    out.push([prefix, value]);
    return;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flattenJson(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

/** A table from a locale JSON file; undefined when it is not JSON or holds no strings. */
export function tableFromJson(file: string, content: string): LocaleTable | undefined {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return undefined;
  }
  const pairs: [string, string][] = [];
  flattenJson(data, "", pairs);
  if (pairs.length === 0) return undefined;
  // JSON.parse keeps key order, so a forward scan finds each leaf's line.
  let cursor = 0;
  const entries = pairs.map(([key, text]) => {
    const leaf = key.split(".").pop() ?? key;
    const at = content.indexOf(JSON.stringify(leaf), cursor);
    if (at >= 0) cursor = at + 1;
    const line = at >= 0 ? content.slice(0, at).split("\n").length : 1;
    return { key, text, line };
  });
  const locale = localeFromPath(file);
  return { file, ...(locale ? { locale } : {}), entries };
}

function flattenStatic(value: StaticValue, prefix: string, out: LocaleEntry[]): void {
  if (value.kind === "str") out.push({ key: prefix, text: value.value, line: value.line });
  else if (value.kind === "obj") {
    for (const [k, v] of value.props) flattenStatic(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

/** Tables from `const messages = {...}` style literals in files or variables that look like i18n. */
export function tablesFromModule(file: string, ast: File): LocaleTable[] {
  const pathLooksI18n = LOCALE_PATH.test(file);
  const tables: LocaleTable[] = [];
  for (const [name, value] of collectConstants(ast)) {
    if (value.kind !== "obj" || (!pathLooksI18n && !TABLE_VAR.test(name))) continue;
    const keys = [...value.props.keys()];
    // { en: {...}, fr: {...} } → one table per locale.
    if (keys.length > 0 && keys.every((k) => LOCALE_NAME.test(k) && value.props.get(k)?.kind === "obj")) {
      for (const [locale, sub] of value.props) {
        const entries: LocaleEntry[] = [];
        flattenStatic(sub, "", entries);
        if (entries.length > 0) tables.push({ file, locale, entries });
      }
      continue;
    }
    const entries: LocaleEntry[] = [];
    flattenStatic(value, "", entries);
    if (entries.length === 0) continue;
    const locale = LOCALE_NAME.test(name) ? name : localeFromPath(file);
    tables.push({ file, ...(locale ? { locale } : {}), entries });
  }
  return tables;
}

/** Preferred tables first: English, then tables without a locale, then the rest. */
export function orderTables(tables: LocaleTable[]): LocaleTable[] {
  const rank = (t: LocaleTable): number => (t.locale?.startsWith("en") ? 0 : t.locale === undefined ? 1 : 2);
  return [...tables].sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file));
}

export type Translation = { text: string; locale?: string; file: string; line: number };

export function createTranslator(tables: LocaleTable[]): (key: string) => Translation | undefined {
  const index = new Map<string, Translation>();
  for (const t of orderTables(tables)) {
    for (const e of t.entries) {
      if (index.has(e.key)) continue;
      index.set(e.key, {
        text: e.text,
        file: t.file,
        line: e.line,
        ...(t.locale ? { locale: t.locale } : {}),
      });
    }
  }
  return (key) => index.get(key);
}
