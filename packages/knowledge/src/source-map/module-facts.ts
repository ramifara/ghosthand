// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Imports, top-level components and the component that encloses each top-level statement.
import type { File, Node, Statement } from "@babel/types";
import { calleeName, unwrapExpression, walk } from "./ast.ts";

export type ImportBinding = { local: string; imported: string; source: string };

export interface ModuleFacts {
  /** Every module specifier (static, re-export or dynamic import). */
  specifiers: string[];
  /** Local name → import, for resolving `<XPage/>` to a file. */
  bindings: Map<string, ImportBinding>;
  components: string[];
}

const COMPONENT_WRAPPERS = new Set(["forwardRef", "memo", "observer", "lazy"]);

function isFunctionish(node: Node): boolean {
  const n = unwrapExpression(node);
  if (n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression") return true;
  if (n.type === "CallExpression") {
    const name = calleeName(n.callee);
    return name !== undefined && COMPONENT_WRAPPERS.has(name);
  }
  return false;
}

/** Names declared by a top-level statement and whether each is function-like. */
export function declaredNames(stmt: Statement): { name: string; fn: boolean }[] {
  const s =
    (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration") && stmt.declaration
      ? stmt.declaration
      : stmt;
  if (s.type === "FunctionDeclaration") return [{ name: s.id?.name ?? "default", fn: true }];
  if (s.type === "ClassDeclaration") return [{ name: s.id?.name ?? "default", fn: true }];
  if (s.type === "VariableDeclaration") {
    return s.declarations.flatMap((d) =>
      d.id.type === "Identifier" ? [{ name: d.id.name, fn: d.init ? isFunctionish(d.init) : false }] : [],
    );
  }
  if (stmt.type === "ExportDefaultDeclaration" && isFunctionish(s)) return [{ name: "default", fn: true }];
  return [];
}

const isComponentName = (name: string): boolean => /^[A-Z]/.test(name) || name === "default";

export function moduleFacts(file: File): ModuleFacts {
  const specifiers: string[] = [];
  const bindings = new Map<string, ImportBinding>();
  const components: string[] = [];
  for (const stmt of file.program.body) {
    if (stmt.type === "ImportDeclaration") {
      const source = stmt.source.value;
      specifiers.push(source);
      if (stmt.importKind === "type") continue;
      for (const sp of stmt.specifiers) {
        const imported =
          sp.type === "ImportDefaultSpecifier"
            ? "default"
            : sp.type === "ImportNamespaceSpecifier"
              ? "*"
              : sp.imported.type === "Identifier"
                ? sp.imported.name
                : sp.imported.value;
        bindings.set(sp.local.name, { local: sp.local.name, imported, source });
      }
      continue;
    }
    if ((stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportAllDeclaration") && stmt.source) {
      specifiers.push(stmt.source.value);
    }
    for (const d of declaredNames(stmt)) if (d.fn && isComponentName(d.name)) components.push(d.name);
  }
  // Dynamic imports (React.lazy, route-level code splitting).
  walk(file.program, (n) => {
    if (n.type === "CallExpression" && n.callee.type === "Import") {
      const arg = n.arguments[0];
      if (arg?.type === "StringLiteral") specifiers.push(arg.value);
    }
    if (n.type === "ImportExpression" && n.source.type === "StringLiteral") specifiers.push(n.source.value);
    return true;
  });
  return { specifiers: [...new Set(specifiers)], bindings, components };
}
