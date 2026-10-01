// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A small invoices page snapshot for resolver tests.
import type { Element, ElementAction, ElementRisk, Region, RoleClass, Snapshot } from "@ghosthand/protocol";

let n = 0;
function el(
  role: string,
  roleClass: RoleClass,
  name: string,
  actions: ElementAction[],
  extra: Partial<Element> & { region?: Region; risk?: ElementRisk } = {},
): Element {
  n++;
  return {
    token: `e${n}`,
    stableId: `s-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${n}`,
    role,
    roleClass,
    nativeRole: role,
    name,
    states: [],
    actions,
    bounds: { x: 0, y: n * 30, width: 100, height: 24 },
    visibleBounds: { x: 0, y: n * 30, width: 100, height: 24 },
    boundsTrust: "exact",
    region: "main",
    frame: "main",
    risk: "safe",
    ...extra,
  };
}

export function invoicePage(): Snapshot {
  n = 0;
  const elements: Element[] = [
    el("link", "link", "Dashboard", ["press"], { region: "nav", risk: "navigates" }),
    el("link", "link", "Invoices", ["press"], { region: "nav", risk: "navigates" }),
    el("link", "link", "Settings", ["press"], { region: "nav", risk: "navigates" }),
    el("link", "link", "Invoice #1041", ["press"], { context: "row: ACME · €120 · paid", risk: "navigates" }),
    el("link", "link", "Invoice #1042", ["press"], {
      context: "row: Globex · €80 · unpaid",
      risk: "navigates",
    }),
    el("link", "link", "Invoice #1043", ["press"], {
      context: "row: Initech · €45 · unpaid",
      risk: "navigates",
    }),
    el("button", "button", "Delete selected", ["press"], { risk: "destructive" }),
    el("textbox", "textbox", "Email", ["set_value", "focus"], { region: "form", value: "<empty>" }),
    el("textbox", "textbox", "Name", ["set_value", "focus"], { region: "form", value: "<empty>" }),
    el("checkbox", "checkbox", "Remember me", ["toggle"], { region: "form", states: ["unchecked"] }),
    el("combobox", "select", "Country", ["select_option"], {
      region: "form",
      options: ["Austria", "Germany", "France"],
      optionCount: 3,
    }),
    el("button", "button", "Save", ["press"], { region: "form", risk: "submits" }),
    el("button", "button", "Export CSV", ["press"]),
    el("link", "link", "Next", ["press"], { risk: "navigates" }),
  ];
  return {
    id: "snap-1",
    surface: "web",
    takenAt: 1,
    url: "http://127.0.0.1:4400/invoices",
    title: "Invoices",
    viewport: { x: 0, y: 0, width: 1280, height: 860 },
    elements,
    text: "Invoices",
    tokenEstimate: 500,
    quality: { elementCount: elements.length, unnamedInteractive: 0, score: 1 },
    narrowed: false,
  };
}

export const byName = (s: Snapshot, name: string): Element => {
  const e = s.elements.find((x) => x.name === name);
  if (!e) throw new Error(`no element ${name}`);
  return e;
};
