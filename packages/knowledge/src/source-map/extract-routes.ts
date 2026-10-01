// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// React Router routes: `<Route path element>` trees and route-object arrays
// (`createBrowserRouter([...])`, `useRoutes([...])`, `const routes: RouteObject[] = [...]`).
import type { ArrayExpression, File, JSXElement, Node, ObjectExpression } from "@babel/types";
import { calleeName, jsxTagName, lineOf, unwrapExpression, walk } from "./ast.ts";
import { toStaticValue } from "./static-value.ts";

export interface RawRoute {
  path?: string;
  index: boolean;
  /** Page component of the route element (the innermost one). */
  component?: string;
  /** Every capitalized component in the element (wrappers such as `<RequireAuth>`). */
  renders: string[];
  line: number;
  children: RawRoute[];
}

const ROUTER_FACTORIES = new Set([
  "createBrowserRouter",
  "createHashRouter",
  "createMemoryRouter",
  "createStaticRouter",
  "useRoutes",
]);

function componentsIn(node: Node): string[] {
  const out: string[] = [];
  walk(node, (n) => {
    if (n.type === "JSXElement") {
      const tag = jsxTagName(n);
      if (/^[A-Z]/.test(tag)) out.push(tag);
    }
    return true;
  });
  return out;
}

function withComponents(route: RawRoute, renders: string[]): RawRoute {
  // The innermost component is the page: `<RequireAuth><Billing /></RequireAuth>` → Billing.
  const page = renders.at(-1);
  if (page !== undefined) route.component = page;
  route.renders = renders;
  return route;
}

function jsxRoute(el: JSXElement, routeTags: ReadonlySet<string>): RawRoute {
  const route: RawRoute = { index: false, renders: [], line: lineOf(el), children: [] };
  for (const attr of el.openingElement.attributes) {
    if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier") continue;
    const key = attr.name.name;
    const value = attr.value;
    if (key === "index") {
      route.index =
        value?.type === "JSXExpressionContainer" && value.expression.type === "BooleanLiteral"
          ? value.expression.value
          : true;
    } else if (key === "path" && value) {
      const v =
        value.type === "JSXExpressionContainer" && value.expression.type !== "JSXEmptyExpression"
          ? toStaticValue(value.expression)
          : value.type === "StringLiteral"
            ? toStaticValue(value)
            : undefined;
      if (v?.kind === "str") route.path = v.value;
    } else if (key === "element" && value?.type === "JSXExpressionContainer") {
      withComponents(route, componentsIn(value.expression));
    } else if (key === "Component" && value?.type === "JSXExpressionContainer") {
      const e = value.expression;
      if (e.type === "Identifier") withComponents(route, [e.name]);
    }
  }
  const visitChildren = (children: JSXElement["children"]): void => {
    for (const child of children) {
      if (child.type === "JSXElement" && routeTags.has(jsxTagName(child))) {
        route.children.push(jsxRoute(child, routeTags));
      } else if (child.type === "JSXFragment" || child.type === "JSXElement") {
        visitChildren(child.children);
      }
    }
  };
  visitChildren(el.children);
  return route;
}

function objectRoute(obj: ObjectExpression, seen: Set<Node>): RawRoute {
  const route: RawRoute = { index: false, renders: [], line: lineOf(obj), children: [] };
  for (const p of obj.properties) {
    if (p.type !== "ObjectProperty" || p.computed || p.key.type !== "Identifier") continue;
    const value = unwrapExpression(p.value);
    switch (p.key.name) {
      case "path": {
        const v = toStaticValue(value);
        if (v?.kind === "str") route.path = v.value;
        break;
      }
      case "index":
        route.index = value.type === "BooleanLiteral" && value.value;
        break;
      case "element":
        withComponents(route, componentsIn(value));
        break;
      case "Component":
        if (value.type === "Identifier") withComponents(route, [value.name]);
        break;
      case "children":
        if (value.type === "ArrayExpression") route.children = objectRoutes(value, seen);
        break;
    }
  }
  return route;
}

function objectRoutes(arr: ArrayExpression, seen: Set<Node>): RawRoute[] {
  seen.add(arr);
  const out: RawRoute[] = [];
  for (const el of arr.elements) {
    const e = el ? unwrapExpression(el) : undefined;
    if (e?.type === "ObjectExpression") out.push(objectRoute(e, seen));
  }
  return out;
}

export function extractRoutes(file: File, routeTags: ReadonlySet<string> = new Set(["Route"])): RawRoute[] {
  const out: RawRoute[] = [];
  const seen = new Set<Node>();
  const arrays = new Map<string, ArrayExpression>();
  const typedRouteArrays: ArrayExpression[] = [];
  walk(file.program, (n) => {
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.init) {
      const init = unwrapExpression(n.init);
      if (init.type === "ArrayExpression") {
        arrays.set(n.id.name, init);
        const ann = n.id.typeAnnotation;
        let typed = false;
        if (ann?.type === "TSTypeAnnotation") {
          walk(ann, (t) => {
            if (t.type === "Identifier" && t.name === "RouteObject") typed = true;
            return !typed;
          });
        }
        if (typed) typedRouteArrays.push(init);
      }
    }
    return true;
  });
  walk(file.program, (n) => {
    if (n.type === "JSXElement" && routeTags.has(jsxTagName(n))) {
      out.push(jsxRoute(n, routeTags));
      return false;
    }
    if (n.type === "CallExpression") {
      const name = calleeName(n.callee);
      const arg = n.arguments[0];
      if (name && ROUTER_FACTORIES.has(name) && arg) {
        const a = unwrapExpression(arg);
        const arr =
          a.type === "ArrayExpression" ? a : a.type === "Identifier" ? arrays.get(a.name) : undefined;
        if (arr && !seen.has(arr)) out.push(...objectRoutes(arr, seen));
      }
    }
    return true;
  });
  for (const arr of typedRouteArrays) if (!seen.has(arr)) out.push(...objectRoutes(arr, seen));
  return out;
}

/** Joins a parent and child route path into an absolute path. */
export function joinRoutePath(parent: string, child: string | undefined): string {
  if (child === undefined || child === "") return parent;
  if (child.startsWith("/")) return child.replace(/\/+$/, "") || "/";
  const base = parent.endsWith("/") ? parent : `${parent}/`;
  return `${base}${child}`.replace(/\/+$/, "") || "/";
}
