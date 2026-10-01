// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Small generic helpers over Babel AST nodes (no @babel/traverse).
import { type JSXElement, type Node, VISITOR_KEYS } from "@babel/types";

export function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string"
  );
}

/** Direct child nodes in source order. */
export function childNodes(node: Node): Node[] {
  const out: Node[] = [];
  const record = node as unknown as Record<string, unknown>;
  for (const key of VISITOR_KEYS[node.type] ?? []) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
}

/** Depth-first walk; return false from `visit` to skip a node's children. */
export function walk(node: Node, visit: (n: Node) => boolean | undefined): void {
  if (visit(node) === false) return;
  for (const child of childNodes(node)) walk(child, visit);
}

export function lineOf(node: Node): number {
  return node.loc?.start.line ?? 1;
}

/** Strips TS-only wrappers: `x as const`, `x satisfies T`, `x!`, `(x)`. */
export function unwrapExpression(node: Node): Node {
  let n = node;
  while (
    n.type === "TSAsExpression" ||
    n.type === "TSSatisfiesExpression" ||
    n.type === "TSNonNullExpression" ||
    n.type === "ParenthesizedExpression" ||
    n.type === "TSTypeAssertion"
  ) {
    n = n.expression;
  }
  return n;
}

/** "Button", "Dialog.Title", "svg:path". */
export function jsxTagName(el: JSXElement): string {
  const name = el.openingElement.name;
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXNamespacedName") return `${name.namespace.name}:${name.name.name}`;
  const parts: string[] = [];
  let cur: typeof name.object | typeof name = name;
  while (cur.type === "JSXMemberExpression") {
    parts.unshift(cur.property.name);
    cur = cur.object;
  }
  parts.unshift(cur.name);
  return parts.join(".");
}

/** Name of the function called, for `foo()` and `a.b.foo()`. */
export function calleeName(callee: Node): string | undefined {
  const c = unwrapExpression(callee);
  if (c.type === "Identifier") return c.name;
  if (c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier")
    return c.property.name;
  return undefined;
}
