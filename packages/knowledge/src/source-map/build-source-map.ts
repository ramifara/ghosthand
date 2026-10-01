// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Builds a SourceMap from in-memory files (root-relative POSIX paths). No I/O; see extract-source-map.ts.
import type { File } from "@babel/types";
import { extractElements, type RawElement, type RawForm } from "./extract-elements.ts";
import { extractRoutes, joinRoutePath, type RawRoute } from "./extract-routes.ts";
import { reachableFiles, resolveImport } from "./import-graph.ts";
import {
  createTranslator,
  LOCALE_PATH,
  type LocaleTable,
  localeFromPath,
  tableFromJson,
  tablesFromModule,
} from "./locale-tables.ts";
import { type ModuleFacts, moduleFacts } from "./module-facts.ts";
import { parseModule } from "./parse-module.ts";
import type { SourceMap, SourceRoute, SourceString } from "./source-map-schema.ts";

export type SourceFile = { path: string; content: string };

export interface BuildSourceMapOptions {
  /** Recorded as `SourceMap.root`. */
  root: string;
  /** Defaults to now. */
  generatedAt?: string;
  /** Functions whose first argument is a testid. Default: tid, testId, testid, getTestId. */
  testidHelpers?: string[];
  /** JSX tags that declare routes. Default: Route. */
  routeTags?: string[];
}

export const DEFAULT_TESTID_HELPERS = ["tid", "testId", "testid", "getTestId"];

type Parsed = { path: string; ast: File; facts: ModuleFacts };
type RouteFile = { raws: RawRoute[]; resolveComponent: (name: string) => string | undefined };
type Layout = { name: string; files: string[] };

const isJson = (p: string): boolean => p.endsWith(".json");

export function buildSourceMap(files: SourceFile[], opts: BuildSourceMapOptions): SourceMap {
  const skipped: SourceMap["skipped"] = [];
  const tables: LocaleTable[] = [];
  const parsed: Parsed[] = [];
  for (const f of files) {
    if (isJson(f.path)) {
      if (!LOCALE_PATH.test(f.path) && !localeFromPath(f.path)) continue;
      const table = tableFromJson(f.path, f.content);
      if (table) tables.push(table);
      continue;
    }
    const res = parseModule(f.content, f.path);
    if (!res.ok) {
      skipped.push({ file: f.path, reason: res.error.message });
      continue;
    }
    parsed.push({ path: f.path, ast: res.value, facts: moduleFacts(res.value) });
    tables.push(...tablesFromModule(f.path, res.value));
  }

  const fileSet = new Set(parsed.map((p) => p.path));
  const graph = new Map<string, string[]>();
  for (const p of parsed) {
    const deps = p.facts.specifiers
      .map((s) => resolveImport(p.path, s, fileSet))
      .filter((d): d is string => d !== undefined && d !== p.path);
    graph.set(p.path, [...new Set(deps)]);
  }

  const translate = createTranslator(tables);
  const usages = new Map<string, string[]>();
  const helpers = new Set(opts.testidHelpers ?? DEFAULT_TESTID_HELPERS);
  const rawElements: RawElement[] = [];
  const rawForms: RawForm[] = [];
  const routeEntries: { route: SourceRoute; reach: Set<string> }[] = [];
  const routeTags = new Set(opts.routeTags ?? ["Route"]);
  const routeFiles = new Map<string, RouteFile>();

  for (const p of parsed) {
    const { elements, forms } = extractElements(p.path, p.ast, {
      testidHelpers: helpers,
      translate: (key) => translate(key)?.text,
      onTranslate: (key, line) => {
        const at = `${p.path}:${line}`;
        const list = usages.get(key) ?? [];
        if (!list.includes(at)) list.push(at);
        usages.set(key, list);
      },
    });
    rawElements.push(...elements);
    rawForms.push(...forms);

    const raws = extractRoutes(p.ast, routeTags);
    if (raws.length === 0) continue;
    const resolveComponent = (name: string): string | undefined => {
      const root = name.split(".")[0] ?? name;
      const binding = p.facts.bindings.get(root);
      if (binding) return resolveImport(p.path, binding.source, fileSet);
      return p.facts.components.includes(root) ? p.path : undefined;
    };
    routeFiles.set(p.path, { raws, resolveComponent });
  }

  // Descendant <Routes> in a component mounted by a splat route ("lab/*" → <LabRoutes/>) are relative
  // to that route, so those files are flattened under it rather than at "/".
  const mounted = new Set<string>();
  const findMounts = (raw: RawRoute, file: RouteFile): void => {
    const target =
      raw.path?.endsWith("*") && raw.component ? file.resolveComponent(raw.component) : undefined;
    if (target && routeFiles.has(target)) mounted.add(target);
    for (const child of raw.children) findMounts(child, file);
  };
  for (const file of routeFiles.values()) for (const raw of file.raws) findMounts(raw, file);

  const flattenFile = (path: string, base: string, outer: Layout[], visiting: Set<string>): void => {
    const file = routeFiles.get(path);
    if (!file || visiting.has(path)) return;
    const inside = new Set([...visiting, path]);
    const flatten = (raw: RawRoute, parentPath: string, layouts: Layout[]): void => {
      const routePath = raw.index ? parentPath : joinRoutePath(parentPath, raw.path);
      const files = raw.renders.map(file.resolveComponent).filter((f): f is string => f !== undefined);
      const componentFile = raw.component ? file.resolveComponent(raw.component) : undefined;
      if (raw.path !== undefined || raw.index) {
        routeEntries.push({
          route: {
            path: routePath,
            ...(raw.component ? { component: raw.component } : {}),
            ...(componentFile ? { componentFile } : {}),
            layouts: layouts.map((l) => l.name),
            index: raw.index,
            file: path,
            line: raw.line,
          },
          reach: reachableFiles(graph, [...files, ...layouts.flatMap((l) => l.files)]),
        });
      }
      const next = raw.component ? [...layouts, { name: raw.component, files }] : layouts;
      if (componentFile && mounted.has(componentFile) && routePath.endsWith("/*")) {
        flattenFile(componentFile, routePath.slice(0, -2) || "/", next, inside);
      }
      for (const child of raw.children) flatten(child, routePath, next);
    };
    for (const raw of file.raws) flatten(raw, base, outer);
  };
  for (const path of routeFiles.keys()) if (!mounted.has(path)) flattenFile(path, "/", [], new Set());

  // One entry per path; an index route wins over its parent, and reachability is merged.
  const byPath = new Map<string, { route: SourceRoute; reach: Set<string> }>();
  for (const entry of routeEntries) {
    const prev = byPath.get(entry.route.path);
    if (!prev) byPath.set(entry.route.path, entry);
    else {
      const [winner, other] =
        entry.route.index && !prev.route.index ? [entry.route, prev.route] : [prev.route, entry.route];
      // An index route without a component (`element: <h2>…</h2>`) keeps the parent's component.
      const route: SourceRoute =
        winner.component || !other.component
          ? winner
          : {
              ...winner,
              component: other.component,
              ...(other.componentFile ? { componentFile: other.componentFile } : {}),
            };
      byPath.set(entry.route.path, { route, reach: new Set([...prev.reach, ...entry.reach]) });
    }
  }
  const routes = [...byPath.values()];
  const routesOf = (file: string): string[] =>
    routes.filter((r) => r.reach.has(file)).map((r) => r.route.path);
  const moduleRoutes = new Map(parsed.map((p) => [p.path, routesOf(p.path)]));

  const strings: SourceString[] = [];
  const tableKeys = new Set<string>();
  for (const t of tables) {
    for (const e of t.entries) {
      tableKeys.add(e.key);
      strings.push({
        key: e.key,
        text: e.text,
        ...(t.locale ? { locale: t.locale } : {}),
        file: t.file,
        line: e.line,
        usedAt: usages.get(e.key) ?? [],
      });
    }
  }
  for (const [key, usedAt] of usages) if (!tableKeys.has(key)) strings.push({ key, usedAt });

  const byLocation = <T extends { file: string; line: number }>(a: T, b: T): number =>
    a.file.localeCompare(b.file) || a.line - b.line;

  return {
    version: 1,
    root: opts.root,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    routes: routes.map((r) => r.route),
    elements: rawElements.map((e) => ({ ...e, routes: moduleRoutes.get(e.file) ?? [] })).sort(byLocation),
    forms: rawForms.map((f) => ({ ...f, routes: moduleRoutes.get(f.file) ?? [] })).sort(byLocation),
    strings,
    modules: parsed
      .map((p) => ({
        file: p.path,
        imports: graph.get(p.path) ?? [],
        components: p.facts.components,
        routes: moduleRoutes.get(p.path) ?? [],
      }))
      .sort((a, b) => a.file.localeCompare(b.file)),
    skipped,
  };
}
