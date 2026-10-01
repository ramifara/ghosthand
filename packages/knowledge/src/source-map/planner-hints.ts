// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Planner helpers: seed targets for `Subgoal.seedTargets` and a compact source context block.
import { INTERACTIVE_ROLES } from "./infer-role.ts";
import { matchRoute } from "./match-route.ts";
import { words } from "./risk.ts";
import type { SourceElement, SourceMap } from "./source-map-schema.ts";

const STOP = new Set(
  "a an the to and or of in on for my your our with then than it its is are be this that from into at by as go open click press tap page screen please make sure all any".split(
    " ",
  ),
);

const stem = (w: string): string => (w.length > 4 ? w.replace(/(ings?|ed|es|s)$/, "") : w);

function goalWords(goal: string): Set<string> {
  return new Set(
    words(goal)
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map(stem),
  );
}

const display = (e: SourceElement): string | undefined => e.name ?? e.text;

/** Elements on the URL's route (all elements when no route matches). */
function onRoute(map: SourceMap, url: string): { route: string | undefined; elements: SourceElement[] } {
  const route = matchRoute(map, url)?.path;
  return { route, elements: route ? map.elements.filter((e) => e.routes.includes(route)) : map.elements };
}

/** Layout chrome (nav bar, session menu): rendered on every route under the route's outermost layout. */
function sharedOn(map: SourceMap, route: string | undefined): (e: SourceElement) => boolean {
  const outer = map.routes.find((r) => r.path === route)?.layouts[0];
  const group = map.routes.filter((r) => outer === undefined || r.layouts[0] === outer).map((r) => r.path);
  if (group.length < 2) return () => false;
  return (e) => group.every((p) => e.routes.includes(p));
}

/**
 * Element names likely relevant to `goal` on the page at `url`: word overlap between the goal and each
 * element's name, text, label and testid, preferring route-specific and interactive elements.
 * Feed the result to `Subgoal.seedTargets` (core ranks elements whose name contains a seed).
 */
export function seedTargetsFor(map: SourceMap, query: { url: string; goal: string }, limit = 8): string[] {
  const goal = goalWords(query.goal);
  if (goal.size === 0) return [];
  const { route, elements } = onRoute(map, query.url);
  const isShared = sharedOn(map, route);
  const scored: { name: string; score: number }[] = [];
  for (const e of elements) {
    const name = display(e);
    if (!name) continue;
    const own = new Set(
      [name, e.text, e.label, e.ariaLabel, e.testid, e.placeholder]
        .filter((s): s is string => s !== undefined)
        .flatMap(words)
        .map(stem),
    );
    let hits = 0;
    for (const w of goal) if (own.has(w)) hits++;
    if (hits === 0) continue;
    const interactive = e.role !== undefined && INTERACTIVE_ROLES.has(e.role);
    const score = hits * 10 + (interactive ? 2 : 0) + (isShared(e) ? 0 : 1);
    scored.push({ name, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const out: string[] = [];
  for (const s of scored) {
    if (!out.includes(s.name)) out.push(s.name);
    if (out.length >= limit) break;
  }
  return out;
}

function describe(e: SourceElement): string {
  const kind = e.role ?? e.tag;
  const name = display(e) ?? e.textPattern;
  const parts = [kind, name ? `"${name}"` : undefined, e.testid ? `[${e.testid}]` : undefined];
  if (e.risk !== "none") parts.push(`(${e.risk})`);
  return parts.filter((p) => p !== undefined).join(" ");
}

/**
 * A compact plain-text block for the planner prompt: the route list, then testids/labels on the
 * current route (route-specific first, shared chrome last), cut to `maxChars`.
 */
export function plannerContext(map: SourceMap, url: string, maxChars = 1500): string {
  const lines: string[] = [];
  const routeList = map.routes.map((r) => (r.component ? `${r.path} (${r.component})` : r.path)).join(", ");
  lines.push(`App routes (from source): ${routeList}`);
  const { route, elements } = onRoute(map, url);
  if (route) {
    const r = map.routes.find((x) => x.path === route);
    lines.push(`Current route: ${route}${r?.component ? ` -> ${r.component}` : ""}`);
  } else {
    lines.push("Current route: unknown");
  }
  const useful = elements.filter((e) => e.role !== undefined && (e.testid || display(e)));
  const isShared = sharedOn(map, route);
  // The page's own file first (stable sort keeps source order), then helpers it imports.
  const pageFile = map.routes.find((x) => x.path === route)?.componentFile;
  const specific = useful
    .filter((e) => !isShared(e))
    .sort((a, b) => Number(b.file === pageFile) - Number(a.file === pageFile));
  const shared = useful.filter((e) => isShared(e));
  const seen = new Set<string>();
  const bullet = (e: SourceElement): string | undefined => {
    const d = describe(e);
    if (seen.has(d)) return undefined;
    seen.add(d);
    return `- ${d}`;
  };
  if (route) {
    const forms = map.forms.filter((f) => f.routes.includes(route) && f.fields.length > 0);
    for (const f of forms) {
      const fields = f.fields.map((x) => x.label ?? x.fieldName ?? x.testid ?? x.tag).join(", ");
      lines.push(
        `Form${f.testid ? ` [${f.testid}]` : ""}: ${fields}${f.submitText ? `; submit "${f.submitText}"` : ""}`,
      );
    }
  }
  if (specific.length > 0) lines.push("On this page:");
  const body = [
    ...specific.map(bullet),
    ...(shared.length > 0 ? ["Shared (every page):"] : []),
    ...shared.map(bullet),
  ].filter((l): l is string => l !== undefined);
  let out = lines.join("\n");
  for (const l of body) {
    if (out.length + l.length + 1 > maxChars) {
      const more = "\n...";
      if (out.length + more.length <= maxChars) out += more;
      break;
    }
    out += `\n${l}`;
  }
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}
