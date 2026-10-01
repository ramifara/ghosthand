// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Functions passed to `locator.evaluate`: they run in the page against one target element and must stay
// self-contained (they are serialized with toString()).

import type { HitTestResult, TargetProbe } from "./page-types.ts";

/** Reads the target's state, value and a hash of its surroundings, before and after an action. */
export function probeTarget(el: Element): TargetProbe {
  const parentOf = (node: Node): Element | null => {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const tristate = (v: string | null): boolean | "mixed" | undefined =>
    v === "true" ? true : v === "false" ? false : v === "mixed" ? "mixed" : undefined;
  const fnv = (text: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  };
  let container: Element = el;
  for (let cur = parentOf(el), depth = 0; cur && depth < 6; cur = parentOf(cur), depth++) {
    container = cur;
    if (cur.matches("tr, [role=row], li, form, fieldset, dialog, [role=dialog], section, article, main"))
      break;
  }
  const containerText =
    container instanceof HTMLElement ? container.innerText : (container.textContent ?? "");
  // innerText does not reach into shadow roots; include the text of the root the target lives in.
  const ownRoot = el.getRootNode();
  const shadowText = ownRoot instanceof ShadowRoot ? (ownRoot.textContent ?? "") : "";
  const r = el.getBoundingClientRect();
  const win = el.ownerDocument.defaultView;
  const vw = win?.innerWidth ?? 0;
  const vh = win?.innerHeight ?? 0;
  let active: Element | null = el.ownerDocument.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  let scroller: Element | null = el;
  while (
    scroller &&
    scroller.scrollHeight <= scroller.clientHeight &&
    scroller.scrollWidth <= scroller.clientWidth
  )
    scroller = parentOf(scroller);
  const out: TargetProbe = {
    tag: el.localName,
    focused: active === el,
    hovered: el.matches(":hover"),
    nearHash: fnv(`${container.childElementCount}|${containerText}|${shadowText}`),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    inViewport: r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw,
    scrollTop: (scroller ?? el.ownerDocument.scrollingElement)?.scrollTop ?? 0,
    scrollLeft: (scroller ?? el.ownerDocument.scrollingElement)?.scrollLeft ?? 0,
  };
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") out.checked = el.indeterminate ? "mixed" : el.checked;
    else out.value = el.value;
  } else if (el instanceof HTMLTextAreaElement) {
    out.value = el.value;
  } else if (el instanceof HTMLSelectElement) {
    out.selectedLabels = Array.from(el.selectedOptions).map((o) => (o.label || o.text).trim());
    out.value = out.selectedLabels.join(", ");
  } else if (el instanceof HTMLElement && el.isContentEditable) {
    out.value = el.innerText;
  } else if (el.getAttribute("role") === "combobox" || el.getAttribute("role") === "listbox") {
    out.value = (el instanceof HTMLElement ? el.innerText : (el.textContent ?? "")).trim();
  }
  const checked = tristate(el.getAttribute("aria-checked"));
  if (out.checked === undefined && checked !== undefined) out.checked = checked;
  const expanded = el.getAttribute("aria-expanded");
  if (expanded === "true" || expanded === "false") out.expanded = expanded === "true";
  else if (el.localName === "summary" && el.parentElement instanceof HTMLDetailsElement)
    out.expanded = el.parentElement.open;
  const selected = el.getAttribute("aria-selected");
  if (selected === "true" || selected === "false") out.selected = selected === "true";
  const pressed = tristate(el.getAttribute("aria-pressed"));
  if (pressed !== undefined) out.pressed = pressed;
  return out;
}

/**
 * Checks that the element at the target's center is the target, one of its descendants, or a label
 * that controls it. Crosses open shadow roots.
 */
export function hitTestTarget(el: Element): HitTestResult {
  const parentOf = (node: Node): Element | null => {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (r.width === 0 || r.height === 0) return { ok: false, hit: "zero-size target", x, y };
  let hit: Element | null = el.ownerDocument.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  if (!hit) return { ok: false, hit: "nothing (outside the viewport)", x, y };
  const describe = (e: Element): string => {
    const id = e.id ? `#${e.id}` : "";
    const cls =
      typeof e.className === "string" && e.className ? `.${e.className.trim().split(/\s+/)[0]}` : "";
    const text = (e.textContent ?? "").trim().slice(0, 40);
    return `${e.localName}${id}${cls}${text ? ` "${text}"` : ""}`;
  };
  for (let cur: Element | null = hit; cur; cur = parentOf(cur)) {
    if (cur === el) return { ok: true, hit: describe(hit), x, y };
    if (cur instanceof HTMLLabelElement && cur.control === el) return { ok: true, hit: describe(hit), x, y };
  }
  return { ok: false, hit: describe(hit), x, y };
}

/** Describes the element at a viewport point, for evidence on coordinate actions. */
export function describePoint(point: { x: number; y: number }): string {
  let hit: Element | null = document.elementFromPoint(point.x, point.y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(point.x, point.y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  if (!hit) return "nothing";
  const role = hit.getAttribute("role");
  const text = (hit.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return `${hit.localName}${role ? `[role=${role}]` : ""}${text ? ` "${text}"` : ""}`;
}

/** Whether the element under a viewport point is hovered. */
export function hoveredAt(point: { x: number; y: number }): boolean {
  let hit: Element | null = document.elementFromPoint(point.x, point.y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(point.x, point.y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit?.matches(":hover") ?? false;
}

/** Page metrics for screenshots and screen-coordinate mapping. */
export function viewportMetrics(): {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenX: number;
  screenY: number;
  scrollX: number;
  scrollY: number;
  dpr: number;
} {
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenX: window.screenX,
    screenY: window.screenY,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    dpr: window.devicePixelRatio,
  };
}

/** Scroll offsets of the page and of the scroll container under a point. */
export function scrollState(point: { x: number; y: number } | null): string {
  const parts = [`${window.scrollX},${window.scrollY}`];
  if (point) {
    let el: Element | null = document.elementFromPoint(point.x, point.y);
    while (el) {
      if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
        parts.push(`${el.scrollLeft},${el.scrollTop}`);
      el = el.parentElement;
    }
  }
  return parts.join("|");
}

/** Snapshot of the focused element and its value length, for keyboard actions. */
export function focusState(): { desc: string; value: string | null; secret: boolean } {
  let a: Element | null = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  if (!a) return { desc: "none", value: null, secret: false };
  const auto = a.getAttribute("autocomplete") ?? "";
  const secret =
    (a instanceof HTMLInputElement && a.type === "password") ||
    /current-password|new-password|one-time-code|cc-number|cc-csc/i.test(auto);
  const value =
    a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement
      ? a.value
      : a instanceof HTMLElement && a.isContentEditable
        ? a.innerText
        : null;
  const role = a.getAttribute("role");
  const label = a.getAttribute("aria-label") ?? a.getAttribute("name") ?? a.id ?? "";
  return { desc: `${a.localName}${role ? `[role=${role}]` : ""}${label ? ` ${label}` : ""}`, value, secret };
}
