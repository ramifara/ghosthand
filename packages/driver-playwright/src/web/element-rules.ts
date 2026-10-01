// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Code rules for role classes, offered actions and risk. No model judgement here.
import type { ElementAction, ElementRisk, RoleClass } from "@ghosthand/protocol";

const ROLE_CLASS: Record<string, RoleClass> = {
  button: "button",
  link: "link",
  textbox: "textbox",
  searchbox: "textbox",
  spinbutton: "textbox",
  checkbox: "checkbox",
  switch: "checkbox",
  menuitemcheckbox: "checkbox",
  radio: "radio",
  menuitemradio: "radio",
  combobox: "select",
  listbox: "select",
  option: "option",
  treeitem: "option",
  menuitem: "menuitem",
  tab: "tab",
  slider: "slider",
  heading: "heading",
  alert: "text",
  status: "text",
  img: "image",
};

export function roleClassOf(role: string): RoleClass {
  return ROLE_CLASS[role] ?? "other";
}

export interface ActionFacts {
  role: string;
  tag: string;
  inputType?: string | undefined;
  /** Editable combobox (an input), as opposed to a native or ARIA select. */
  editable: boolean;
  pointer: boolean;
}

/** Operations offered for an element. Disabled elements keep their actions; the core filters them. */
export function actionsFor(f: ActionFacts): ElementAction[] {
  const base: ElementAction[] = ["focus", "scroll_into_view"];
  switch (f.role) {
    case "heading":
    case "alert":
    case "status":
      return ["scroll_into_view"];
    case "textbox":
    case "searchbox":
    case "spinbutton":
      return ["set_value", ...base];
    case "combobox":
      return f.editable ? ["set_value", "press", ...base] : ["select_option", ...base];
    case "listbox":
      return ["select_option", ...base];
    case "checkbox":
    case "switch":
    case "radio":
    case "menuitemcheckbox":
    case "menuitemradio":
      return ["toggle", ...base];
    case "slider":
      return base;
    default:
      return ["press", ...base];
  }
}

const DESTRUCTIVE =
  /\b(delete|remove|destroy|erase|discard|wipe|purge|terminate|deactivate|revoke|unsubscribe|close (my |your |the )?account|cancel (my |your |the )?(subscription|plan|membership|order))\b/i;

export interface RiskFacts {
  role: string;
  name: string;
  tag: string;
  submits: boolean;
  /** Absolute link target. */
  href?: string | undefined;
  /** Origin of the page the element is on. */
  pageOrigin?: string | undefined;
}

export function riskFor(f: RiskFacts): ElementRisk {
  if (DESTRUCTIVE.test(f.name)) return "destructive";
  if (f.href !== undefined) {
    let target: URL;
    try {
      target = new URL(f.href);
    } catch {
      return "unknown";
    }
    if (target.protocol === "javascript:") return "unknown";
    if (target.protocol !== "http:" && target.protocol !== "https:") return "external";
    if (f.pageOrigin !== undefined && target.origin !== f.pageOrigin) return "external";
    return "navigates";
  }
  if (f.submits) return "submits";
  switch (f.role) {
    case "textbox":
    case "searchbox":
    case "spinbutton":
    case "combobox":
    case "listbox":
    case "checkbox":
    case "switch":
    case "radio":
    case "slider":
    case "tab":
    case "option":
    case "treeitem":
    case "heading":
    case "alert":
    case "status":
      return "safe";
    case "link":
      return "navigates";
    default:
      return "unknown";
  }
}

/** Link target shown to the model: path for same-origin links, full URL otherwise. */
export function hrefFor(href: string, pageOrigin: string | undefined): string {
  try {
    const u = new URL(href);
    if (u.protocol === "javascript:") return "javascript:";
    if (pageOrigin !== undefined && u.origin === pageOrigin) return `${u.pathname}${u.search}${u.hash}`;
    if (u.protocol === "http:" || u.protocol === "https:") return `${u.origin}${u.pathname}${u.search}`;
    return `${u.protocol}…`;
  } catch {
    return href.slice(0, 120);
  }
}
