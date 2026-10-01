// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Best-effort static evaluation of expressions to strings, objects and arrays (no execution).
import type { File, Node, Statement } from "@babel/types";
import { calleeName, lineOf, unwrapExpression, walk } from "./ast.ts";

export type StaticValue =
  /** `pattern`: dynamic parts were replaced by `*`. */
  | { kind: "str"; value: string; line: number; pattern?: boolean }
  | { kind: "bool"; value: boolean; line: number }
  | { kind: "obj"; props: Map<string, StaticValue>; line: number }
  | { kind: "arr"; items: StaticValue[]; line: number };

/** A string candidate; `pattern` means dynamic parts were replaced by `*`. */
export type StaticString = { value: string; pattern: boolean; line?: number };

export interface Scope {
  lookup(name: string): StaticValue | undefined;
  /** Resolves an i18n key to text. */
  translate?(key: string): string | undefined;
  /** Called for each `t("key")` evaluated. */
  onTranslate?(key: string, line: number): void;
  /** Helpers like `tid("x")` that evaluate to `{ "data-testid": "x" }`. */
  testidHelpers?: ReadonlySet<string>;
}

export const TRANSLATE_CALLEES = new Set(["t", "$t", "translate", "i18nT"]);

const EMPTY_SCOPE: Scope = { lookup: () => undefined };

function propKey(key: Node): string | undefined {
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  if (key.type === "NumericLiteral") return String(key.value);
  return undefined;
}

/** Literal-only evaluation (no identifiers). */
export function toStaticValue(input: Node): StaticValue | undefined {
  return resolveValue(input, EMPTY_SCOPE);
}

/** All `const NAME = <literal>` bindings in the file (first wins on shadowing). */
export function collectConstants(file: File): Map<string, StaticValue> {
  const out = new Map<string, StaticValue>();
  walk(file.program, (n) => {
    if (n.type === "VariableDeclaration" && n.kind === "const") {
      for (const d of n.declarations) {
        if (d.id.type !== "Identifier" || !d.init || out.has(d.id.name)) continue;
        const v = toStaticValue(d.init);
        if (v) out.set(d.id.name, v);
      }
    }
    return true;
  });
  return out;
}

/** Evaluates an expression in a scope. Unknown parts make the result undefined (or drop object members). */
export function resolveValue(input: Node, scope: Scope): StaticValue | undefined {
  const node = unwrapExpression(input);
  const line = lineOf(node);
  switch (node.type) {
    case "StringLiteral":
      return { kind: "str", value: node.value, line };
    case "NumericLiteral":
      return { kind: "str", value: String(node.value), line };
    case "BooleanLiteral":
      return { kind: "bool", value: node.value, line };
    case "TemplateLiteral": {
      const [only, more] = evalStrings(node, scope);
      if (!only || more) return undefined;
      return { kind: "str", value: only.value, line, ...(only.pattern ? { pattern: true } : {}) };
    }
    case "Identifier":
      return scope.lookup(node.name);
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const obj = resolveValue(node.object, scope);
      if (!obj) return undefined;
      let key: string | undefined;
      if (!node.computed && node.property.type === "Identifier") key = node.property.name;
      else if (node.computed) {
        const k = resolveValue(node.property, scope);
        if (k?.kind === "str" && !k.pattern) key = k.value;
      }
      if (key === undefined) return undefined;
      if (obj.kind === "obj") return obj.props.get(key);
      if (obj.kind === "arr" && /^\d+$/.test(key)) return obj.items[Number(key)];
      return undefined;
    }
    case "ObjectExpression": {
      const props = new Map<string, StaticValue>();
      for (const p of node.properties) {
        if (p.type === "SpreadElement") {
          const v = resolveValue(p.argument, scope);
          if (v?.kind === "obj") for (const [k, pv] of v.props) props.set(k, pv);
          continue;
        }
        if (p.type !== "ObjectProperty" || p.computed) continue;
        const key = propKey(p.key);
        if (key === undefined) continue;
        const value = resolveValue(p.value, scope);
        if (value) props.set(key, value);
      }
      return { kind: "obj", props, line };
    }
    case "ArrayExpression": {
      const items: StaticValue[] = [];
      for (const el of node.elements) {
        if (!el || el.type === "SpreadElement") continue;
        const v = resolveValue(el, scope);
        if (v) items.push(v);
      }
      return { kind: "arr", items, line };
    }
    case "CallExpression": {
      const name = calleeName(node.callee);
      const first = node.arguments[0];
      if (name && first && scope.testidHelpers?.has(name)) {
        const id = resolveValue(first, scope);
        if (id?.kind !== "str") return undefined;
        return { kind: "obj", props: new Map([["data-testid", id]]), line };
      }
      const [only] = evalStrings(node, scope);
      return only ? { kind: "str", value: only.value, line } : undefined;
    }
    default:
      return undefined;
  }
}

/** The i18n key of `t("key")`, or undefined. */
export function translateKey(node: Node): string | undefined {
  const n = unwrapExpression(node);
  if (n.type !== "CallExpression") return undefined;
  const name = calleeName(n.callee);
  if (!name || !TRANSLATE_CALLEES.has(name)) return undefined;
  const arg = n.arguments[0];
  if (!arg) return undefined;
  const v = toStaticValue(arg);
  return v?.kind === "str" ? v.value : undefined;
}

/** String candidates an expression can produce. Empty when unknown. */
export function evalStrings(input: Node, scope: Scope): StaticString[] {
  const node = unwrapExpression(input);
  switch (node.type) {
    case "TemplateLiteral": {
      let value = "";
      let pattern = false;
      node.quasis.forEach((q, i) => {
        value += q.value.cooked ?? q.value.raw;
        const expr = node.expressions[i];
        if (!expr) return;
        const parts = evalStrings(expr, scope);
        const only = parts.length === 1 ? parts[0] : undefined;
        if (only && !only.pattern) value += only.value;
        else {
          value += only ? only.value : "*";
          pattern = true;
        }
      });
      return [{ value, pattern, line: lineOf(node) }];
    }
    case "ConditionalExpression": {
      const branch = truthiness(node.test, scope);
      if (branch === true) return evalStrings(node.consequent, scope);
      if (branch === false) return evalStrings(node.alternate, scope);
      return [...evalStrings(node.consequent, scope), ...evalStrings(node.alternate, scope)];
    }
    case "LogicalExpression":
      return node.operator === "&&"
        ? evalStrings(node.right, scope)
        : [...evalStrings(node.left, scope), ...evalStrings(node.right, scope)];
    case "CallExpression": {
      const key = translateKey(node);
      if (key === undefined) return [];
      scope.onTranslate?.(key, lineOf(node));
      const text = scope.translate?.(key);
      return text === undefined ? [] : [{ value: text, pattern: false }];
    }
    default: {
      const v = resolveValue(node, scope);
      return v?.kind === "str" ? [{ value: v.value, pattern: v.pattern ?? false, line: v.line }] : [];
    }
  }
}

/**
 * Static truthiness of a condition, only where it is safe: literals, and member reads on a static object
 * (a missing property of a static data item is falsy). Undefined when unknown.
 */
export function truthiness(input: Node, scope: Scope): boolean | undefined {
  const node = unwrapExpression(input);
  if (node.type === "UnaryExpression" && node.operator === "!") {
    const t = truthiness(node.argument, scope);
    return t === undefined ? undefined : !t;
  }
  if (node.type === "BooleanLiteral") return node.value;
  if ((node.type === "MemberExpression" || node.type === "OptionalMemberExpression") && !node.computed) {
    const obj = resolveValue(node.object, scope);
    if (obj?.kind !== "obj" || node.property.type !== "Identifier") return undefined;
    const v = obj.props.get(node.property.name);
    if (v === undefined) return false;
    if (v.kind === "bool") return v.value;
    if (v.kind === "str") return v.pattern ? undefined : v.value !== "";
    return true;
  }
  return undefined;
}

function inherit(parent: Scope, lookup: Scope["lookup"]): Scope {
  return {
    lookup,
    ...(parent.translate ? { translate: parent.translate } : {}),
    ...(parent.onTranslate ? { onTranslate: parent.onTranslate } : {}),
    ...(parent.testidHelpers ? { testidHelpers: parent.testidHelpers } : {}),
  };
}

/** Scope with value bindings (e.g. a `.map` parameter) layered over a parent. */
export function childScope(parent: Scope, bindings: Map<string, StaticValue>): Scope {
  return inherit(parent, (name) => (bindings.has(name) ? bindings.get(name) : parent.lookup(name)));
}

/** Scope for a block: its `const x = expr` declarations evaluate lazily in the block scope itself. */
export function blockScope(parent: Scope, body: Statement[]): Scope {
  const decls = new Map<string, Node>();
  for (const stmt of body) {
    if (stmt.type !== "VariableDeclaration" || stmt.kind !== "const") continue;
    for (const d of stmt.declarations) if (d.id.type === "Identifier" && d.init) decls.set(d.id.name, d.init);
  }
  if (decls.size === 0) return parent;
  const memo = new Map<string, StaticValue | undefined>();
  const self: Scope = inherit(parent, (name) => {
    const init = decls.get(name);
    if (!init) return parent.lookup(name);
    if (memo.has(name)) return memo.get(name);
    memo.set(name, undefined); // cycle guard
    const v = resolveValue(init, self);
    memo.set(name, v);
    return v;
  });
  return self;
}
