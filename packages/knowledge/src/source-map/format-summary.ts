// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Short human-readable summary of a SourceMap (for `ghosthand sourcemap <dir>`).
import type { SourceMap } from "./source-map-schema.ts";

export function formatSourceMapSummary(map: SourceMap, topTestids = 12): string {
  const testids = new Set(map.elements.flatMap((e) => (e.testid ? [e.testid] : [])));
  const patterns = new Set(map.elements.flatMap((e) => (e.testidPattern ? [e.testidPattern] : [])));
  const destructive = map.elements.filter((e) => e.risk === "destructive").length;
  const external = map.elements.filter((e) => e.risk === "external").length;
  const resolved = map.strings.filter((s) => s.text !== undefined).length;
  const lines = [
    `Source map of ${map.root}`,
    `${map.routes.length} routes, ${map.elements.length} elements (${testids.size} testids, ${patterns.size} testid patterns), ` +
      `${map.forms.length} forms, ${map.strings.length} i18n strings (${resolved} resolved), ${map.modules.length} modules`,
    `Risk: ${destructive} destructive, ${external} external`,
    "Routes:",
    ...map.routes.map((r) => `  ${r.path}${r.component ? ` -> ${r.component}` : ""}  (${r.file}:${r.line})`),
  ];
  // Testids that are reachable from the most routes first (chrome), then by name.
  const byTestid = new Map<string, { routes: number; at: string }>();
  for (const e of map.elements) {
    if (!e.testid || byTestid.has(e.testid)) continue;
    byTestid.set(e.testid, { routes: e.routes.length, at: `${e.file}:${e.line}` });
  }
  const top = [...byTestid.entries()]
    .sort((a, b) => b[1].routes - a[1].routes || a[0].localeCompare(b[0]))
    .slice(0, topTestids);
  if (top.length > 0) {
    lines.push(`Top testids (${top.length} of ${byTestid.size}):`);
    for (const [id, info] of top) lines.push(`  ${id}  ${info.at}`);
  }
  if (map.skipped.length > 0) {
    lines.push(`Skipped ${map.skipped.length} file(s): ${map.skipped.map((s) => s.file).join(", ")}`);
  }
  return lines.join("\n");
}
