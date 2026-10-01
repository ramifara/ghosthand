// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand sourcemap <dir> [--diff <base>]`: the source map of a React/TS app (routes, test ids, forms),
// and with --diff the changed surface and the zero-model checks derived from it.
import { resolve } from "node:path";
import {
  diffOracles,
  extractSourceMap,
  formatSourceMapSummary,
  gitChangedSurface,
} from "@ghosthand/knowledge";
import { fail, out } from "../io.ts";

export async function sourcemapCommand(
  dir: string | undefined,
  flags: { json: boolean; diff?: string },
): Promise<number> {
  if (!dir) return fail("usage: ghosthand sourcemap <dir> [--diff <base>] [--json]", 2);
  const root = resolve(dir);
  const t0 = performance.now();
  const map = await extractSourceMap(root);
  if (!map.ok)
    return fail(
      map.error.kind === "root-not-found"
        ? `no directory ${map.error.root}`
        : `cannot read ${map.error.path}: ${map.error.message}`,
    );
  const ms = Math.round(performance.now() - t0);
  if (!flags.diff) {
    out(
      flags.json
        ? JSON.stringify(map.value, null, 2)
        : `${formatSourceMapSummary(map.value)}\n(extracted in ${ms} ms)`,
    );
    return 0;
  }
  const surface = await gitChangedSurface(map.value, { cwd: root, base: flags.diff });
  if (!surface.ok)
    return fail(
      surface.error.kind === "invalid-ref"
        ? `invalid ref ${surface.error.ref}`
        : `diff failed: ${surface.error.message}`,
    );
  const checks = diffOracles(map.value, surface.value);
  if (flags.json) {
    out(JSON.stringify({ surface: surface.value, checks }, null, 2));
    return 0;
  }
  const s = surface.value;
  out(`changed files: ${s.files.length} (${s.outOfScope.length} outside the source map)`);
  out(`affected routes: ${s.routes.join(", ") || "none"}`);
  out(
    `test ids added: ${s.testids.added.join(", ") || "none"}; removed: ${s.testids.removed.join(", ") || "none"}`,
  );
  out(`zero-model checks (${checks.length}):`);
  for (const c of checks) out(`  ${c.route}: ${JSON.stringify(c.predicate)}  (${c.reason})`);
  return 0;
}
