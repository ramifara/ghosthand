// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Reads a source tree from disk and builds its SourceMap.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { err, ok, type Result } from "@ghosthand/protocol";
import { type BuildSourceMapOptions, buildSourceMap, type SourceFile } from "./build-source-map.ts";
import { LOCALE_PATH, localeFromPath } from "./locale-tables.ts";
import type { SourceMap } from "./source-map-schema.ts";

export type SourceMapError =
  | { kind: "root-not-found"; root: string }
  | { kind: "read-failed"; path: string; message: string };

export interface ExtractSourceMapOptions extends Omit<BuildSourceMapOptions, "root"> {
  /** File-name suffixes to read. Default: .tsx .ts .jsx .js .mjs .json (JSON only for locale tables). */
  include?: string[];
  /** Path substrings to skip (root-relative). Tests, stories, fixtures and declarations are always skipped. */
  exclude?: string[];
}

export const DEFAULT_INCLUDE = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "__fixtures__",
  "__recordings__",
]);
const SKIP_FILE = /\.(test|spec|stories|story)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function listFiles(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await listFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

export async function extractSourceMap(
  rootDir: string,
  opts: ExtractSourceMapOptions = {},
): Promise<Result<SourceMap, SourceMapError>> {
  try {
    if (!(await stat(rootDir)).isDirectory()) return err({ kind: "root-not-found", root: rootDir });
  } catch {
    return err({ kind: "root-not-found", root: rootDir });
  }
  const all: string[] = [];
  try {
    await listFiles(rootDir, all);
  } catch (e) {
    return err({ kind: "read-failed", path: rootDir, message: message(e) });
  }
  const include = opts.include ?? DEFAULT_INCLUDE;
  const exclude = opts.exclude ?? [];
  const files: SourceFile[] = [];
  for (const full of all.sort()) {
    const path = relative(rootDir, full).split(sep).join("/");
    if (!include.some((s) => path.endsWith(s)) || SKIP_FILE.test(path)) continue;
    if (exclude.some((x) => path.includes(x))) continue;
    if (path.endsWith(".json") && !LOCALE_PATH.test(path) && !localeFromPath(path)) continue;
    try {
      files.push({ path, content: await readFile(full, "utf8") });
    } catch (e) {
      return err({ kind: "read-failed", path, message: message(e) });
    }
  }
  const { include: _include, exclude: _exclude, ...build } = opts;
  return ok(buildSourceMap(files, { ...build, root: rootDir }));
}
