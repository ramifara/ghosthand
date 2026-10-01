// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Elements and forms from JSX: testids (tid() helpers, data-testid, template patterns), aria-label, role,
// id/name/placeholder, htmlFor labels, literal content text, handlers. `.map` over const arrays is expanded.
import type { File, JSXElement, Node } from "@babel/types";
import { calleeName, childNodes, jsxTagName, lineOf, unwrapExpression, walk } from "./ast.ts";
import {
  FIELD_ROLES,
  INTERACTIVE_ROLES,
  inferRole,
  LABEL_TAGS,
  NAME_FROM_CONTENT,
  TEXT_TAGS,
} from "./infer-role.ts";
import { declaredNames } from "./module-facts.ts";
import { riskOf } from "./risk.ts";
import type { SourceElement, SourceForm, SourceFormField } from "./source-map-schema.ts";
import {
  blockScope,
  childScope,
  collectConstants,
  evalStrings,
  resolveValue,
  type Scope,
  type StaticString,
  type StaticValue,
  truthiness,
} from "./static-value.ts";

export type RawElement = Omit<SourceElement, "routes">;
export type RawForm = Omit<SourceForm, "routes">;

export interface ExtractElementsOptions {
  /** Helpers whose first argument is a testid, e.g. `tid("login.submit")`. */
  testidHelpers: ReadonlySet<string>;
  translate?: (key: string) => string | undefined;
  onTranslate?: (key: string, line: number) => void;
}

const TESTID_ATTRS = new Set(["data-testid", "data-test-id", "data-test", "data-cy", "data-qa"]);
const FORM_TAGS = new Set(["form", "Form"]);
const CONTROL_TAGS = new Set(["input", "Input", "select", "textarea", "Textarea"]);
const MAX_TEXT = 140;
const INLINE_TAGS = new Set([
  "b",
  "i",
  "em",
  "strong",
  "span",
  "code",
  "kbd",
  "small",
  "mark",
  "abbr",
  "time",
  "br",
  "s",
  "u",
  "sub",
  "sup",
]);
const MAX_ALTERNATIVES = 4;

interface Ctx {
  component: string;
  scope: Scope;
  /** Inside a `.map` expansion over static data. */
  expanded: boolean;
  /** Text of a wrapping <label>. */
  labelText?: string | undefined;
  form?: RawForm | undefined;
}

interface Pending {
  el: RawElement;
  labelledBy?: string;
  title?: string;
  variant?: string;
  type?: string;
  required: boolean;
  form?: RawForm;
  field: boolean;
  submit: boolean;
}

const hasAlnum = (s: string): boolean => /[\p{L}\p{N}]/u.test(s);
const normalize = (s: string): string => s.replace(/\s+/g, " ").trim();

function exactOf(cands: StaticString[] | undefined): StaticString | undefined {
  return cands?.find((c) => !c.pattern);
}

/** Text alternatives of JSX children; dynamic parts become `*`. */
function textCandidates(children: JSXElement["children"], scope: Scope): string[] {
  let acc = [""];
  const append = (alts: string[]): void => {
    const next: string[] = [];
    for (const a of acc) for (const b of alts) next.push(a + b);
    acc = [...new Set(next)].slice(0, MAX_ALTERNATIVES);
  };
  for (const child of children) {
    switch (child.type) {
      case "JSXText":
        append([child.value.replace(/\s+/g, " ")]);
        break;
      case "JSXElement":
        if (!isAriaHidden(child)) append(textCandidates(child.children, scope));
        break;
      case "JSXFragment":
        append(textCandidates(child.children, scope));
        break;
      case "JSXExpressionContainer":
        if (child.expression.type !== "JSXEmptyExpression") append(expressionTexts(child.expression, scope));
        break;
      case "JSXSpreadChild":
        append(["*"]);
        break;
    }
  }
  return acc;
}

function expressionTexts(input: Node, scope: Scope): string[] {
  const node = unwrapExpression(input);
  switch (node.type) {
    case "JSXElement":
      return isAriaHidden(node) ? [""] : textCandidates(node.children, scope);
    case "JSXFragment":
      return textCandidates(node.children, scope);
    case "NullLiteral":
    case "BooleanLiteral":
      return [""];
    case "Identifier":
      if (node.name === "undefined") return [""];
      break;
    case "ConditionalExpression":
      return [...expressionTexts(node.consequent, scope), ...expressionTexts(node.alternate, scope)];
    case "LogicalExpression":
      if (node.operator === "&&") return [...expressionTexts(node.right, scope), ""];
      break;
  }
  const strings = evalStrings(node, scope);
  return strings.length > 0 ? strings.map((s) => s.value) : ["*"];
}

function isAriaHidden(el: JSXElement): boolean {
  for (const a of el.openingElement.attributes) {
    if (a.type !== "JSXAttribute" || a.name.type !== "JSXIdentifier" || a.name.name !== "aria-hidden")
      continue;
    const v = a.value;
    if (!v) return true;
    if (v.type === "StringLiteral") return v.value === "true";
    if (v.type === "JSXExpressionContainer" && v.expression.type === "BooleanLiteral")
      return v.expression.value;
    return false;
  }
  return false;
}

/** True when children include block-level elements (rows, cards, lists): their text is not a label. */
function hasStructuralChildren(children: JSXElement["children"]): boolean {
  let found = false;
  for (const child of children) {
    walk(child, (n) => {
      if (found) return false;
      if (n.type === "JSXElement") {
        const tag = jsxTagName(n);
        if (!INLINE_TAGS.has(tag) && !isAriaHidden(n)) found = true;
      }
      return !found;
    });
  }
  return found;
}

/** Names and short literals an on* handler refers to: `deleteInvoice`, `onAction("delete", o)`. */
function handlerWords(expr: Node): string[] {
  const out: string[] = [];
  const top = unwrapExpression(expr);
  walk(top, (n) => {
    // Calls inside nested callbacks (`setX((s) => { s.delete(id) })`) are implementation detail.
    if (n !== top && (n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression")) return false;
    if (n.type === "CallExpression") {
      const name = calleeName(n.callee);
      if (name) out.push(name);
    } else if (n.type === "MemberExpression" && !n.computed && n.property.type === "Identifier") {
      out.push(n.property.name);
    } else if (n.type === "Identifier" && n === top) {
      out.push(n.name);
    } else if (n.type === "StringLiteral" && n.value.length <= 40) {
      out.push(n.value);
    }
    return true;
  });
  return [...new Set(out)].slice(0, 8);
}

function bindParam(param: Node | undefined, item: StaticValue): Map<string, StaticValue> {
  const out = new Map<string, StaticValue>();
  if (!param) return out;
  if (param.type === "Identifier") out.set(param.name, item);
  else if (param.type === "ObjectPattern" && item.kind === "obj") {
    for (const p of param.properties) {
      if (p.type !== "ObjectProperty" || p.computed || p.key.type !== "Identifier") continue;
      const target = p.value.type === "AssignmentPattern" ? p.value.left : p.value;
      const v = item.props.get(p.key.name);
      if (target.type === "Identifier" && v) out.set(target.name, v);
    }
  }
  return out;
}

export function extractElements(
  file: string,
  ast: File,
  opts: ExtractElementsOptions,
): {
  elements: RawElement[];
  forms: RawForm[];
} {
  const constants = collectConstants(ast);
  const base: Scope = blockScope(
    {
      lookup: (name) => constants.get(name),
      testidHelpers: opts.testidHelpers,
      ...(opts.translate ? { translate: opts.translate } : {}),
      ...(opts.onTranslate ? { onTranslate: opts.onTranslate } : {}),
    },
    ast.program.body,
  );
  const pending: Pending[] = [];
  const forms: RawForm[] = [];
  const labelsFor = new Map<string, string>();
  const nameById = new Map<string, string>();

  function expandMap(node: Node, ctx: Ctx): boolean {
    if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return false;
    const prop = node.callee.property;
    if (prop.type !== "Identifier" || (prop.name !== "map" && prop.name !== "flatMap")) return false;
    const fn = node.arguments[0];
    if (!fn || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) return false;
    const arr = resolveValue(node.callee.object, ctx.scope);
    if (arr?.kind !== "arr" || arr.items.length === 0) return false;
    for (const item of arr.items) {
      const scope = childScope(ctx.scope, bindParam(fn.params[0], item));
      visit(fn.body, { ...ctx, scope, expanded: true });
    }
    return true;
  }

  function visit(node: Node, ctx: Ctx): void {
    if (node.type === "JSXElement") {
      visitJsx(node, ctx);
      return;
    }
    if (expandMap(node, ctx)) return;
    if (node.type === "ConditionalExpression") {
      const t = truthiness(node.test, ctx.scope);
      if (t !== undefined) {
        visit(t ? node.consequent : node.alternate, ctx);
        return;
      }
    }
    if (
      node.type === "LogicalExpression" &&
      node.operator === "&&" &&
      truthiness(node.left, ctx.scope) === false
    ) {
      return;
    }
    const scoped = node.type === "BlockStatement" ? { ...ctx, scope: blockScope(ctx.scope, node.body) } : ctx;
    for (const child of childNodes(node)) visit(child, scoped);
  }

  function visitJsx(el: JSXElement, ctx: Ctx): void {
    const tag = jsxTagName(el);
    const strings = new Map<string, StaticString[]>();
    const present = new Set<string>();
    const testids: StaticString[] = [];
    const handlers: string[] = [];
    const attrExprs: Node[] = [];

    for (const attr of el.openingElement.attributes) {
      if (attr.type === "JSXSpreadAttribute") {
        // `{...tid("x")}`, `{...{ "data-testid": "x" }}`, `{...common}` with `const common = { id, ...tid(...) }`.
        const v = resolveValue(attr.argument, ctx.scope);
        if (v?.kind !== "obj") continue;
        for (const [key, pv] of v.props) {
          if (pv.kind !== "str") continue;
          const cand: StaticString = { value: pv.value, pattern: pv.pattern ?? false, line: pv.line };
          if (TESTID_ATTRS.has(key)) testids.push(cand);
          else if (!strings.has(key)) {
            present.add(key);
            strings.set(key, [cand]);
          }
        }
        continue;
      }
      const name =
        attr.name.type === "JSXIdentifier"
          ? attr.name.name
          : `${attr.name.namespace.name}:${attr.name.name.name}`;
      present.add(name);
      const value = attr.value;
      let cands: StaticString[] = [];
      if (value?.type === "StringLiteral") cands = [{ value: value.value, pattern: false }];
      else if (value?.type === "JSXExpressionContainer" && value.expression.type !== "JSXEmptyExpression") {
        const expr = value.expression;
        attrExprs.push(expr);
        if (/^on[A-Z]/.test(name)) handlers.push(...handlerWords(expr));
        const inner = unwrapExpression(expr);
        if (inner.type === "BooleanLiteral" && !inner.value) present.delete(name);
        // `thumbProps={tid("x")}`: a testid helper passed through a prop.
        if (inner.type === "CallExpression") {
          const callee = calleeName(inner.callee);
          const v = callee && opts.testidHelpers.has(callee) ? resolveValue(inner, ctx.scope) : undefined;
          const id = v?.kind === "obj" ? v.props.get("data-testid") : undefined;
          if (id?.kind === "str")
            testids.push({ value: id.value, pattern: id.pattern ?? false, line: id.line });
        }
        cands = evalStrings(expr, ctx.scope);
      } else if (value?.type === "JSXElement" || value?.type === "JSXFragment") {
        attrExprs.push(value);
      }
      strings.set(name, cands);
      if (TESTID_ATTRS.has(name)) testids.push(...cands);
    }

    const str = (name: string): string | undefined => exactOf(strings.get(name))?.value;
    const ariaHidden = isAriaHidden(el);
    const asTag = str("as");
    const type = str("type");
    const explicitRole = str("role");
    const roleAttrs = { role: explicitRole, type, href: present.has("href") || present.has("to") };
    const role = (asTag ? inferRole(asTag, roleAttrs) : undefined) ?? inferRole(tag, roleAttrs);

    const exactTestid = exactOf(testids);
    const patternTestid = exactTestid ? undefined : testids.find((t) => t.pattern && hasAlnum(t.value));

    const nameFromContent = TEXT_TAGS.has(tag) || (role !== undefined && NAME_FROM_CONTENT.has(role));
    const wantsText =
      nameFromContent ||
      ((exactTestid !== undefined || patternTestid !== undefined) && !hasStructuralChildren(el.children));
    let text: string | undefined;
    let texts: string[] | undefined;
    let textPattern: string | undefined;
    if (wantsText) {
      const cands = textCandidates(el.children, ctx.scope)
        .map(normalize)
        .filter((t) => t.length > 0 && t.length <= MAX_TEXT);
      const exact = cands.filter((t) => !t.includes("*"));
      text = exact.at(-1);
      if (exact.length > 1) texts = exact;
      if (!text) textPattern = cands.find((t) => hasAlnum(t.replaceAll("*", "")));
    }

    const ariaLabel = str("aria-label");
    const domId = str("id");
    const fieldName = str("name");
    const placeholder = str("placeholder");
    const isLabel = LABEL_TAGS.has(tag);
    const htmlFor = str("htmlFor");
    if (isLabel && htmlFor && text) labelsFor.set(htmlFor, text);
    if (domId && (ariaLabel ?? text)) nameById.set(domId, ariaLabel ?? text ?? "");

    const isField = CONTROL_TAGS.has(tag) || (role !== undefined && FIELD_ROLES.has(role));
    const identifying =
      exactTestid ?? patternTestid ?? ariaLabel ?? domId ?? fieldName ?? placeholder ?? text ?? textPattern;
    const asChildWrapper = present.has("asChild") && !exactTestid && !ariaLabel;
    const emit =
      !ariaHidden &&
      !asChildWrapper &&
      identifying !== undefined &&
      (role !== undefined ||
        exactTestid !== undefined ||
        patternTestid !== undefined ||
        ariaLabel !== undefined ||
        fieldName !== undefined ||
        placeholder !== undefined ||
        isLabel ||
        TEXT_TAGS.has(tag));

    let form = ctx.form;
    if (FORM_TAGS.has(tag)) {
      form = {
        ...(exactTestid ? { testid: exactTestid.value } : {}),
        ...((ariaLabel ?? exactTestid?.value) ? { name: ariaLabel ?? exactTestid?.value } : {}),
        fields: [],
        file,
        line: lineOf(el),
        component: ctx.component,
      };
      forms.push(form);
    }

    if (emit && !FORM_TAGS.has(tag)) {
      const line = (ctx.expanded ? (exactTestid?.line ?? patternTestid?.line) : undefined) ?? lineOf(el);
      const raw: RawElement = {
        tag,
        file,
        line,
        component: ctx.component,
        risk: "none",
        ...(exactTestid ? { testid: exactTestid.value } : {}),
        ...(patternTestid ? { testidPattern: patternTestid.value } : {}),
        ...(role ? { role } : {}),
        ...(ariaLabel ? { ariaLabel } : {}),
        ...(text ? { text } : {}),
        ...(texts ? { texts } : {}),
        ...(textPattern ? { textPattern } : {}),
        ...(placeholder ? { placeholder } : {}),
        ...(domId ? { domId } : {}),
        ...(fieldName ? { fieldName } : {}),
        ...(ctx.labelText && !isLabel ? { label: ctx.labelText } : {}),
        ...(handlers.length > 0 ? { handlers: [...new Set(handlers)] } : {}),
      };
      const p: Pending = {
        el: raw,
        required: present.has("required") || str("aria-required") === "true",
        field: isField && form !== undefined,
        submit:
          form !== undefined &&
          role === "button" &&
          (type === "submit" || (type === undefined && (tag === "button" || tag === "Button"))),
      };
      const labelledBy = str("aria-labelledby");
      const title = str("title");
      const variant = str("variant");
      if (labelledBy) p.labelledBy = labelledBy;
      if (title) p.title = title;
      if (variant) p.variant = variant;
      if (type) p.type = type;
      if (form) p.form = form;
      pending.push(p);
    }

    for (const expr of attrExprs) visit(expr, ctx);
    const childCtx: Ctx = { ...ctx, form, ...(isLabel && text ? { labelText: text } : {}) };
    for (const child of el.children) visit(child, childCtx);
  }

  for (const stmt of ast.program.body) {
    const names = declaredNames(stmt);
    const component = names.find((n) => n.fn)?.name ?? names[0]?.name ?? "<module>";
    visit(stmt, { component, scope: base, expanded: false });
  }

  const elements: RawElement[] = [];
  const seen = new Set<string>();
  for (const p of pending) {
    const el = p.el;
    if (!el.label && el.domId) {
      const label = labelsFor.get(el.domId);
      if (label) el.label = label;
    }
    const labelled = p.labelledBy
      ?.split(/\s+/)
      .map((id) => nameById.get(id))
      .filter((s): s is string => s !== undefined)
      .join(" ");
    const fromContent = el.role !== undefined && NAME_FROM_CONTENT.has(el.role) ? el.text : undefined;
    const name =
      el.ariaLabel ?? (labelled || undefined) ?? fromContent ?? el.label ?? el.placeholder ?? p.title;
    if (name) el.name = name;
    const actionable =
      (el.role !== undefined && INTERACTIVE_ROLES.has(el.role)) || (el.handlers?.length ?? 0) > 0;
    if (actionable) {
      // Testids are left out: "order.delete.cancel" names the dialog, not the action.
      const labels = [el.name, el.text, el.ariaLabel].filter((s): s is string => s !== undefined);
      el.risk = riskOf({ handlers: el.handlers ?? [], labels, variant: p.variant });
    }
    const key = [el.file, el.line, el.tag, el.testid, el.testidPattern, el.name, el.text].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    elements.push(el);
    if (p.form && p.field) {
      const field: SourceFormField = {
        tag: el.tag,
        required: p.required,
        line: el.line,
        ...(el.role ? { role: el.role } : {}),
        ...(el.fieldName ? { fieldName: el.fieldName } : {}),
        ...(el.domId ? { domId: el.domId } : {}),
        ...((el.label ?? el.name) ? { label: el.label ?? el.name } : {}),
        ...(p.type ? { type: p.type } : {}),
        ...(el.testid ? { testid: el.testid } : {}),
        ...(el.placeholder ? { placeholder: el.placeholder } : {}),
      };
      p.form.fields.push(field);
    }
    if (p.form && p.submit && !p.form.submitText && el.text) p.form.submitText = el.text;
  }
  return { elements, forms };
}
