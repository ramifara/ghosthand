// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Relative-import resolution and reachability over root-relative POSIX paths.
import { posix } from "node:path";

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs"];

/** Resolves a relative specifier from `fromFile` to a file in `files`; bare specifiers return undefined. */
export function resolveImport(
  fromFile: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  const candidates = [base];
  // NodeNext-style "./x.js" that points at x.ts / x.tsx.
  const js = /\.(m?js|jsx)$/.exec(base);
  if (js) candidates.push(...EXTENSIONS.map((e) => base.slice(0, -js[0].length) + e));
  candidates.push(...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => `${base}/index${e}`));
  return candidates.find((c) => files.has(c));
}

export type ImportGraph = ReadonlyMap<string, readonly string[]>;

/** Every file reachable from `starts` (inclusive) through relative imports. */
export function reachableFiles(graph: ImportGraph, starts: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length > 0) {
    const f = stack.pop();
    if (f === undefined || seen.has(f)) continue;
    seen.add(f);
    for (const next of graph.get(f) ?? []) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}
