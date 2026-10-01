// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Lookups over a SourceMap: testid → locations, route table, and joining runtime elements to source.
import { LABEL_TAGS } from "./infer-role.ts";
import type { SourceElement, SourceMap, SourceRoute } from "./source-map-schema.ts";

export type SourceElementQuery = {
  /** Runtime `Element.automationId` (data-testid). */
  testid?: string | undefined;
  role?: string | undefined;
  /** Runtime accessible name. */
  name?: string | undefined;
};

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
const escapeRe = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

const patternCache = new Map<string, RegExp>();
/** `orders.row.*` matches `orders.row.42`; `*` spans any characters. */
export function matchesPattern(pattern: string, value: string): boolean {
  let re = patternCache.get(pattern);
  if (!re) {
    re = new RegExp(`^${pattern.split("*").map(escapeRe).join(".*")}$`, "i");
    patternCache.set(pattern, re);
  }
  return re.test(value);
}

/** testid → ["file:line", ...]. Pattern testids are keyed by their pattern. */
export function testidIndex(map: Pick<SourceMap, "elements">): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of map.elements) {
    const id = e.testid ?? e.testidPattern;
    if (!id) continue;
    const at = `${e.file}:${e.line}`;
    const list = out.get(id) ?? [];
    if (!list.includes(at)) list.push(at);
    out.set(id, list);
  }
  return out;
}

/** route path → route. */
export function routeIndex(map: Pick<SourceMap, "routes">): Map<string, SourceRoute> {
  return new Map(map.routes.map((r) => [r.path, r]));
}

function nameMatches(e: SourceElement, name: string): "exact" | "pattern" | undefined {
  const n = norm(name);
  for (const c of [e.name, e.text, e.ariaLabel, e.label, ...(e.texts ?? [])]) {
    if (c !== undefined && norm(c) === n) return "exact";
  }
  if (e.textPattern && matchesPattern(norm(e.textPattern), n)) return "pattern";
  return undefined;
}

/**
 * Source elements for a runtime element: exact testid first, then testid patterns, then role + name.
 * With a role, same-role elements win; role-less source elements (custom components whose role was
 * not inferred) are the fallback, never labels.
 */
export function findSourceElements(
  map: Pick<SourceMap, "elements">,
  query: SourceElementQuery,
): SourceElement[] {
  const { testid, name } = query;
  if (testid) {
    const exact = map.elements.filter((e) => e.testid === testid);
    if (exact.length > 0) return exact;
    const patterned = map.elements.filter((e) => e.testidPattern && matchesPattern(e.testidPattern, testid));
    if (patterned.length > 0) return patterned;
  }
  if (name) {
    const byName = (keep: (e: SourceElement) => boolean): SourceElement[] => {
      const exact: SourceElement[] = [];
      const patterned: SourceElement[] = [];
      for (const e of map.elements) {
        if (!keep(e)) continue;
        const m = nameMatches(e, name);
        if (m === "exact") exact.push(e);
        else if (m === "pattern") patterned.push(e);
      }
      return exact.length > 0 ? exact : patterned;
    };
    if (!query.role) return byName(() => true);
    const sameRole = byName((e) => e.role === query.role);
    return sameRole.length > 0 ? sameRole : byName((e) => e.role === undefined && !LABEL_TAGS.has(e.tag));
  }
  if (query.role && !testid) return map.elements.filter((e) => e.role === query.role);
  return [];
}
