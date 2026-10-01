// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Zero-model oracles derived from source: which testids a route can render, and predicates for
// "every testid or heading added in the diff renders on its route".
import type { Predicate } from "@ghosthand/protocol";
import type { ChangedSurface } from "./diff-scope.ts";
import { matchRoute } from "./match-route.ts";
import type { SourceElement, SourceMap } from "./source-map-schema.ts";

/**
 * Exact testids that elements reachable from the route can render. Some are conditional (dialogs,
 * signed-in only), so treat this as "may appear", not "must appear".
 */
export function expectedTestidsForRoute(map: SourceMap, route: string): string[] {
  const path = map.routes.some((r) => r.path === route) ? route : matchRoute(map, route)?.path;
  if (!path) return [];
  const ids = map.elements.filter((e) => e.testid && e.routes.includes(path)).map((e) => e.testid ?? "");
  return [...new Set(ids)].sort();
}

export type RoutedPredicate = {
  route: string;
  predicate: Predicate;
  /** Why this check exists. */
  reason: "testid-added" | "heading-added";
  testid?: string;
  file: string;
  line: number;
};

function predicateFor(e: SourceElement): Predicate | undefined {
  if (e.name) return { kind: "visible", name: e.name, ...(e.role ? { role: e.role } : {}) };
  if (e.text) return { kind: "text", text: e.text };
  return undefined;
}

/**
 * Deterministic checks for a diff: each added testid's element is visible on each of its routes (by
 * role + name, since protocol predicates have no testid kind), and each added heading's text appears.
 * Elements without a static name or text are skipped.
 */
export function diffOracles(map: SourceMap, surface: ChangedSurface): RoutedPredicate[] {
  const out: RoutedPredicate[] = [];
  const seen = new Set<string>();
  const push = (e: SourceElement, reason: RoutedPredicate["reason"], predicate: Predicate): void => {
    for (const route of e.routes) {
      const key = `${route}|${JSON.stringify(predicate)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        route,
        predicate,
        reason,
        file: e.file,
        line: e.line,
        ...(e.testid ? { testid: e.testid } : {}),
      });
    }
  };
  const added = new Set([...surface.testids.added, ...surface.testids.renamed.map((r) => r.to)]);
  for (const e of map.elements) {
    if (!e.testid || !added.has(e.testid)) continue;
    const p = predicateFor(e);
    if (p) push(e, "testid-added", p);
  }
  for (const e of surface.elements) {
    if (e.role === "heading" && e.text) push(e, "heading-added", { kind: "text", text: e.text });
  }
  return out;
}
