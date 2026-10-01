// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// PR/diff scoping (general-agent-design §2.4): changed files → components → routes (import graph),
// testids added/removed/renamed, routes added/removed. Pure: works on diff text and the head SourceMap.
import { DEFAULT_TESTID_HELPERS } from "./build-source-map.ts";
import { joinRoutePath } from "./extract-routes.ts";
import { matchesPattern } from "./lookups.ts";
import { words } from "./risk.ts";
import type { SourceElement, SourceMap } from "./source-map-schema.ts";
import { type DiffHunk, type FileDiff, parseNameOnly, parseUnifiedDiff } from "./unified-diff.ts";

export interface DiffInput {
  /** Output of `git diff --name-only base...head`. */
  nameOnly?: string;
  /** Unified diff text (`git diff base...head`). Enables testid, route and line-level scoping. */
  patch?: string;
  /** Scanned root relative to the repo root (e.g. "apps/testbed/web/src"). Diff paths outside it are out of scope. */
  pathPrefix?: string;
  testidHelpers?: string[];
}

export interface ChangedSurface {
  /** Changed files inside the scanned root (root-relative). */
  files: string[];
  /** Changed repo paths outside the scanned root. */
  outOfScope: string[];
  /** Components defined in changed files. */
  components: string[];
  /** Routes that can render a changed file (or whose definition changed). */
  routes: string[];
  routesAdded: string[];
  routesRemoved: string[];
  testids: { added: string[]; removed: string[]; renamed: { from: string; to: string }[] };
  /** Head elements on added lines (or in added files); all elements of changed files without a patch. */
  elements: SourceElement[];
  /** True when a patch was given, so line-level results are available. */
  precise: boolean;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const templateToPattern = (s: string): string => s.replace(/\$\{[^}]*\}/g, "*");

function testidRegexes(helpers: string[]): RegExp[] {
  const names = helpers.map(escapeRe).join("|");
  return [
    new RegExp(`\\b(?:${names})\\(\\s*(["'\`])((?:(?!\\1).)*)\\1`, "g"),
    /["']?data-(?:testid|test-id|test|cy|qa)["']?\s*[=:]\s*\{?\s*(["'`])((?:(?!\1).)*)\1/g,
  ];
}

const DOTTED_LITERAL = /(["'`])([A-Za-z][\w-]*(?:\.[\w*${}-]+)+)\1/g;
const ROUTE_PATH = /\bpath\s*[=:]\s*\{?\s*(["'`])([^"'`]*)\1/g;

function matchAll(re: RegExp, text: string): string[] {
  re.lastIndex = 0;
  return [...text.matchAll(re)].map((m) => templateToPattern(m[2] ?? "")).filter((s) => s.length > 0);
}

function normalizePrefix(prefix: string | undefined): string {
  return (prefix ?? "").replace(/^\.\//, "").replace(/\/+$/, "");
}

function inScope(path: string, prefix: string): string | undefined {
  if (prefix === "") return path;
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : undefined;
}

/** A testid seen on a diff line, with the line's text minus the id (to recognise renames). */
type IdOnLine = { id: string; skeleton: Set<string> };
type HunkIds = { added: IdOnLine[]; removed: IdOnLine[] };

function skeleton(text: string, id: string): Set<string> {
  return new Set(words(text.replace(id, " ")));
}

/** Jaccard similarity of the two lines' words without the ids. */
function similar(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 && b.size === 0) return true;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / (a.size + b.size - common) >= 0.5;
}

function hunkTestids(
  hunk: DiffHunk,
  file: string,
  regexes: RegExp[],
  elementsByLine: Map<string, SourceElement[]>,
): HunkIds {
  const added: IdOnLine[] = [];
  const removed: IdOnLine[] = [];
  const push = (list: IdOnLine[], id: string, text: string): void => {
    if (!list.some((x) => x.id === id)) list.push({ id, skeleton: skeleton(text, id) });
  };
  let dataDriven = false;
  for (const l of hunk.lines) {
    const ids = regexes.flatMap((re) => matchAll(re, l.text));
    if (l.kind === "add") {
      // Testids built from data (`{ id: "nav.x" }` rendered through `tid(l.id)`) sit on a line the map knows.
      for (const e of elementsByLine.get(`${file}:${l.line}`) ?? []) {
        const id = e.testid ?? e.testidPattern;
        if (id && !ids.includes(id) && l.text.includes(id)) {
          ids.push(id);
          dataDriven = true;
        }
      }
      for (const id of ids) push(added, id, l.text);
    } else {
      for (const id of ids) push(removed, id, l.text);
    }
  }
  if (dataDriven) {
    for (const l of hunk.lines) {
      if (l.kind === "del") for (const id of matchAll(DOTTED_LITERAL, l.text)) push(removed, id, l.text);
    }
  }
  return { added, removed };
}

function routePaths(hunks: DiffHunk[], kind: "add" | "del"): { path: string; line: number }[] {
  return hunks.flatMap((h) =>
    h.lines
      .filter((l) => l.kind === kind)
      .flatMap((l) => {
        ROUTE_PATH.lastIndex = 0;
        return [...l.text.matchAll(ROUTE_PATH)].map((m) => ({ path: m[2] ?? "", line: l.line }));
      }),
  );
}

export function scopeDiff(map: SourceMap, input: DiffInput): ChangedSurface {
  const prefix = normalizePrefix(input.pathPrefix);
  const diffs: FileDiff[] = input.patch ? parseUnifiedDiff(input.patch) : [];
  const repoPaths = new Set<string>(parseNameOnly(input.nameOnly ?? ""));
  for (const d of diffs) {
    if (d.newPath) repoPaths.add(d.newPath);
    if (d.oldPath) repoPaths.add(d.oldPath);
  }
  const files: string[] = [];
  const outOfScope: string[] = [];
  for (const p of repoPaths) {
    const rel = inScope(p, prefix);
    if (rel === undefined) outOfScope.push(p);
    else files.push(rel);
  }
  const fileSet = new Set(files);
  const modules = new Map(map.modules.map((m) => [m.file, m]));

  const components = [...new Set(files.flatMap((f) => modules.get(f)?.components ?? []))];
  const routes = new Set(files.flatMap((f) => modules.get(f)?.routes ?? []));

  const elementsByLine = new Map<string, SourceElement[]>();
  for (const e of map.elements) {
    const key = `${e.file}:${e.line}`;
    elementsByLine.set(key, [...(elementsByLine.get(key) ?? []), e]);
  }

  const regexes = testidRegexes(input.testidHelpers ?? DEFAULT_TESTID_HELPERS);
  const perHunk: HunkIds[] = [];
  const addedLines = new Map<string, Set<number>>();
  const addedFiles = new Set<string>();
  const routesAdded = new Set<string>();
  const routesRemoved = new Set<string>();

  for (const d of diffs) {
    const newRel = d.newPath ? inScope(d.newPath, prefix) : undefined;
    const oldRel = d.oldPath ? inScope(d.oldPath, prefix) : undefined;
    const rel = newRel ?? oldRel;
    if (rel === undefined) continue;
    if (d.status === "added" && newRel) addedFiles.add(newRel);
    const lines = new Set<number>();
    for (const h of d.hunks) {
      perHunk.push(hunkTestids(h, rel, regexes, elementsByLine));
      for (const l of h.lines) if (l.kind === "add") lines.add(l.line);
    }
    if (newRel) addedLines.set(newRel, lines);

    const plus = routePaths(d.hunks, "add");
    const minus = routePaths(d.hunks, "del");
    const minusSet = new Set(minus.map((m) => m.path));
    const plusSet = new Set(plus.map((p) => p.path));
    const defined = map.routes.filter((r) => r.file === newRel);
    for (const p of plus) {
      if (minusSet.has(p.path)) continue;
      const candidates = defined.filter(
        (r) => r.path === joinRoutePath("/", p.path) || r.path.endsWith(`/${p.path.replace(/^\/+/, "")}`),
      );
      const nearest = candidates.sort((a, b) => Math.abs(a.line - p.line) - Math.abs(b.line - p.line))[0];
      routesAdded.add(nearest?.path ?? joinRoutePath("/", p.path));
    }
    for (const m of minus) if (!plusSet.has(m.path)) routesRemoved.add(joinRoutePath("/", m.path));
    // Route definitions on changed lines affect those routes directly.
    for (const r of defined) if (lines.has(r.line)) routes.add(r.path);
  }
  for (const r of routesAdded) routes.add(r);
  if (!input.patch) {
    // Without hunks, a changed route file affects every route it defines.
    for (const r of map.routes) if (fileSet.has(r.file)) routes.add(r.path);
  }

  // Testids on both sides anywhere (moved or line edited) are unchanged.
  const allAdded = new Set(perHunk.flatMap((h) => h.added.map((x) => x.id)));
  const allRemoved = new Set(perHunk.flatMap((h) => h.removed.map((x) => x.id)));
  const both = new Set([...allAdded].filter((id) => allRemoved.has(id)));
  const stillExists = (id: string): boolean =>
    map.elements.some((e) => e.testid === id || (e.testidPattern !== undefined && e.testidPattern === id));
  const renamed: { from: string; to: string }[] = [];
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const h of perHunk) {
    const adds = h.added.filter((x) => !both.has(x.id));
    const dels = h.removed.filter((x) => !both.has(x.id) && !stillExists(x.id));
    // A removed and an added id on otherwise similar lines of one hunk is a rename.
    const paired = new Set<IdOnLine>();
    for (const del of dels) {
      const add = adds.find((x) => !paired.has(x) && similar(x.skeleton, del.skeleton));
      if (add) {
        paired.add(add);
        paired.add(del);
        renamed.push({ from: del.id, to: add.id });
      }
    }
    for (const x of adds) if (!paired.has(x)) added.add(x.id);
    for (const x of dels) if (!paired.has(x)) removed.add(x.id);
  }

  const elements = map.elements.filter((e) => {
    if (!fileSet.has(e.file)) return false;
    if (!input.patch || addedFiles.has(e.file)) return true;
    return addedLines.get(e.file)?.has(e.line) ?? false;
  });

  return {
    files: files.sort(),
    outOfScope: outOfScope.sort(),
    components: components.sort(),
    routes: [...routes].sort(),
    routesAdded: [...routesAdded].sort(),
    routesRemoved: [...routesRemoved].filter((r) => !map.routes.some((x) => x.path === r)).sort(),
    testids: {
      added: [...added].sort(),
      removed: [...removed].sort(),
      renamed,
    },
    elements,
    precise: input.patch !== undefined,
  };
}

/** True when a runtime testid is one of the surface's added testids (patterns included). */
export function isAddedTestid(surface: ChangedSurface, testid: string): boolean {
  return surface.testids.added.some(
    (id) => id === testid || (id.includes("*") && matchesPattern(id, testid)),
  );
}
