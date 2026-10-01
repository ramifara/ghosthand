// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Matches a URL or path to the most specific route (static > :param > splat).
import type { SourceMap, SourceRoute } from "./source-map-schema.ts";

/** "/settings?tab=x#y" or "http://host/settings/" → "/settings". */
export function pathOf(urlOrPath: string): string {
  let path = urlOrPath;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return "/";
    }
  }
  path = path.split(/[?#]/)[0] ?? "/";
  if (!path.startsWith("/")) path = `/${path}`;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

const segments = (p: string): string[] => p.split("/").filter((s) => s.length > 0);

/** Score of `path` against a route pattern, or undefined when it does not match. */
export function routeScore(pattern: string, path: string): number | undefined {
  const pat = segments(pattern);
  const got = segments(path);
  let score = 0;
  for (let i = 0; i < pat.length; i++) {
    const p = pat[i] ?? "";
    if (p === "*") return score + 1;
    const g = got[i];
    if (g === undefined) return p.endsWith("?") ? score : undefined;
    if (p.startsWith(":")) score += 2;
    else if (p.toLowerCase() === decodeURIComponent(g).toLowerCase()) score += 3;
    else return undefined;
  }
  return got.length === pat.length ? score + 1 : undefined;
}

export function matchRoute(map: Pick<SourceMap, "routes">, urlOrPath: string): SourceRoute | undefined {
  const path = pathOf(urlOrPath);
  let best: SourceRoute | undefined;
  let bestScore = -1;
  for (const r of map.routes) {
    const s = routeScore(r.path, path);
    if (s !== undefined && s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return best;
}
