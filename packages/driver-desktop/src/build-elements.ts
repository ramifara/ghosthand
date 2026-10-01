// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Native nodes → the protocol element table: ARIA roles, offered operations, states, redacted values,
// row/group context, regions, risk and stable ids. Tokens are valid for one snapshot only.
import { createHash } from "node:crypto";
import type { SecretsRegistry } from "@ghosthand/core";
import { estimateTokens, renderElement, riskFromName, secretPlaceholder } from "@ghosthand/core";
import type {
  BoundsTrust,
  DesktopPlatform,
  Element,
  ElementRisk,
  Rect,
  Region,
  RegionSummary,
  RpcNode,
  RpcSnapshot,
  SurfaceQuality,
} from "@ghosthand/protocol";
import {
  actionsFor,
  ariaRole,
  CONTAINER_ROLES,
  hasNativeAction,
  roleClassOf,
  statesFor,
  TEXT_ROLES,
} from "./role-map.ts";

export const DEFAULT_MAX_ELEMENTS = 200;
export const DEFAULT_MAX_TOKENS = 20_000;
const MAX_VALUE_CHARS = 200;
const MAX_TEXT_CHARS = 6000;
const MAX_CONTEXT_CHARS = 120;

/** `e<ref><snapshotId>`, e.g. "e12d3". */
export const DESKTOP_TOKEN = /^e(\d+)(d\d+)$/;
export const desktopToken = (ref: number, snapshotId: string): string => `e${ref}${snapshotId}`;

export interface BuildInput {
  snapshot: RpcSnapshot;
  platform: DesktopPlatform;
  boundsTrust: BoundsTrust;
  /** Client snapshot id ("d<n>"). */
  snapshotId: string;
  secrets: SecretsRegistry;
}

export interface BuiltTable {
  elements: Element[];
  /** token → host ref. */
  refs: Map<string, number>;
  secretTokens: Set<string>;
  /** token → region id (top-level window). */
  sections: Map<string, string>;
  /** token → host refs of its ancestors (for token-scoped observation). */
  ancestors: Map<string, number[]>;
  text: string;
  regions: RegionSummary[];
}

const FIELD_ROLES = new Set([
  "textbox",
  "spinbutton",
  "slider",
  "combobox",
  "listbox",
  "checkbox",
  "switch",
  "radio",
  "menuitemcheckbox",
  "menuitemradio",
]);
const ROW_NATIVE = new Set([
  "list item",
  "table row",
  "tree item",
  "table cell",
  "ListItem",
  "DataItem",
  "TreeItem",
  "AXRow",
  "AXCell",
  "AXOutlineRow",
]);
const SUBMIT_NAME = /^(save|submit|apply|ok|confirm|done|create|update|sign in|log in|continue)\b/i;

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "unnamed"
  );
}

const hex4 = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 4);
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const tidy = (s: string): string => s.replace(/\s+/g, " ").trim();

function idPrefix(platform: DesktopPlatform): string {
  switch (platform) {
    case "windows":
      return "uia";
    case "macos":
      return "ax";
    default:
      return "atspi";
  }
}

/** Redacted value: `<empty>`, `[input:NAME]` for a registered secret, `<filled>` for secret fields, else text. */
export function redactNodeValue(
  value: string | undefined,
  valueLength: number | undefined,
  secret: boolean,
  secrets: SecretsRegistry,
): string | undefined {
  if (secret) {
    if (valueLength === undefined && value === undefined) return undefined;
    return (valueLength ?? value?.length ?? 0) > 0 ? "<filled>" : "<empty>";
  }
  if (value === undefined) return undefined;
  if (value.length === 0) return "<empty>";
  const name = secrets.match(value);
  if (name !== undefined) return secretPlaceholder(name);
  return clip(secrets.redact(tidy(value)), MAX_VALUE_CHARS);
}

export function riskFor(role: string, name: string, node: RpcNode): ElementRisk {
  if (FIELD_ROLES.has(role)) return "safe";
  const named = riskFromName(name);
  if (named) return named;
  switch (role) {
    case "link":
      return "navigates";
    case "button":
    case "menuitem":
      // Desktop forms have no submit event: default buttons and save/apply-style names carry the commit.
      return node.states.includes("default") || SUBMIT_NAME.test(name) ? "submits" : "unknown";
    case "tab":
    case "option":
    case "treeitem":
    case "row":
    case "cell":
      return "safe";
    default:
      return "unknown";
  }
}

function clipRect(r: Rect, screen: Rect): Rect | null {
  const x0 = Math.max(r.x, screen.x);
  const y0 = Math.max(r.y, screen.y);
  const x1 = Math.min(r.x + r.width, screen.x + screen.width);
  const y1 = Math.min(r.y + r.height, screen.y + screen.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function buildElements(input: BuildInput): BuiltTable {
  const { snapshot, platform, secrets } = input;
  const nodes = snapshot.nodes;
  const byRef = new Map<number, RpcNode>();
  for (const n of nodes) byRef.set(n.ref, n);
  const roles = new Map<number, string>();
  for (const n of nodes) roles.set(n.ref, ariaRole(platform, n));
  const children = new Map<number, RpcNode[]>();
  for (const n of nodes) {
    if (n.parent === null) continue;
    const list = children.get(n.parent) ?? [];
    list.push(n);
    children.set(n.parent, list);
  }
  const ancestorsOf = (n: RpcNode): RpcNode[] => {
    const out: RpcNode[] = [];
    let p = n.parent;
    let guard = 0;
    while (p !== null && guard++ < 200) {
      const a = byRef.get(p);
      if (!a) break;
      out.push(a);
      p = a.parent;
    }
    return out;
  };

  // Regions: one per top-level window.
  const windowRegion = new Map<number, { id: string; kind: RegionSummary["kind"]; label: string }>();
  const usedRegionIds = new Set<string>();
  for (const n of nodes) {
    if (n.window !== n.ref) continue;
    const role = roles.get(n.ref) ?? "window";
    const kind: RegionSummary["kind"] = role === "dialog" || role === "alertdialog" ? "dialog" : "main";
    let id = `${kind === "dialog" ? "dialog" : "window"}-${slug(n.name)}`;
    if (usedRegionIds.has(id)) id = `${id}-${n.ref}`;
    usedRegionIds.add(id);
    windowRegion.set(n.ref, { id, kind, label: secrets.redact(tidy(n.name)) });
  }

  const regionOf = (n: RpcNode, anc: RpcNode[]): Region => {
    for (const a of anc) {
      const r = roles.get(a.ref);
      if (r === "dialog" || r === "alertdialog") return "dialog";
      if (r === "menubar") return "nav";
      if (r === "toolbar") return "header";
      if (r === "status") return "footer";
    }
    const w = roles.get(n.window);
    return w === "dialog" || w === "alertdialog" ? "dialog" : "main";
  };

  const labelTextOf = (n: RpcNode): string => tidy(n.text ?? n.name);

  const contextOf = (n: RpcNode, anc: RpcNode[], ownName: string): string | undefined => {
    for (const a of anc) {
      const r = roles.get(a.ref) ?? "";
      const row = ROW_NATIVE.has(a.role) || r === "row" || r === "option" || r === "treeitem";
      const namedGroup = (r === "group" || r === "form" || r === "dialog") && tidy(a.name).length > 0;
      if (!row && !namedGroup) continue;
      let text = tidy(a.name);
      if (!text) {
        const parts: string[] = [];
        for (const c of children.get(a.ref) ?? []) {
          if (c.ref === n.ref) continue;
          const t = labelTextOf(c);
          if (t && t !== ownName && TEXT_ROLES.has(roles.get(c.ref) ?? "")) parts.push(t);
          if (parts.length >= 3) break;
        }
        text = parts.join(" · ");
      }
      if (text && text !== ownName) return clip(secrets.redact(text), MAX_CONTEXT_CHARS);
      if (row) return undefined;
    }
    return undefined;
  };

  /**
   * A sibling label names an unnamed field (forms without label relations). By geometry: the nearest label on
   * the same row to the left, else the nearest one just above; without bounds, the adjacent sibling.
   */
  const siblingLabel = (n: RpcNode): string => {
    if (n.parent === null) return "";
    const sibs = (children.get(n.parent) ?? []).filter(
      (s) => s.ref !== n.ref && TEXT_ROLES.has(roles.get(s.ref) ?? "") && labelTextOf(s),
    );
    const b = n.bounds;
    if (b) {
      let best: { d: number; s: RpcNode } | undefined;
      for (const s of sibs) {
        const sb = s.bounds;
        if (!sb) continue;
        const cy = sb.y + sb.height / 2;
        const sameRow = cy >= b.y && cy <= b.y + b.height && sb.x + sb.width <= b.x + 8;
        const above =
          sb.y + sb.height <= b.y + 4 &&
          b.y - (sb.y + sb.height) < 40 &&
          sb.x < b.x + b.width &&
          sb.x + sb.width > b.x;
        const d = sameRow ? b.x - (sb.x + sb.width) : above ? 1000 + b.y - (sb.y + sb.height) : Number.NaN;
        if (!Number.isNaN(d) && (best === undefined || d < best.d)) best = { d, s };
      }
      if (best) return labelTextOf(best.s);
    }
    const all = children.get(n.parent) ?? [];
    const i = all.findIndex((s) => s.ref === n.ref);
    for (const j of [i - 1, i + 1]) {
      const s = all[j];
      if (s && TEXT_ROLES.has(roles.get(s.ref) ?? "") && !b) return labelTextOf(s);
    }
    return "";
  };

  const elements: Element[] = [];
  const refs = new Map<string, number>();
  const secretTokens = new Set<string>();
  const sections = new Map<string, string>();
  const ancestors = new Map<string, number[]>();
  const texts: string[] = [];
  const seenText = new Set<string>();
  const baseCounts = new Map<string, number>();
  const pending: Array<{ el: Element; base: string; path: string }> = [];

  for (const n of nodes) {
    let role = roles.get(n.ref) ?? "generic";
    if (TEXT_ROLES.has(role) || (role === "img" && !hasNativeAction(n))) {
      const t = labelTextOf(n);
      if (t && !seenText.has(t)) {
        seenText.add(t);
        texts.push(t);
      }
      continue;
    }
    if (CONTAINER_ROLES.has(role)) {
      // Custom widgets: a named generic/group node with a native action acts like a button.
      if ((role === "generic" || role === "group") && hasNativeAction(n) && tidy(n.name)) role = "button";
      else continue;
    }
    const anc = ancestorsOf(n);
    let name = tidy(n.name);
    const rawValue = n.value ?? n.selectedOption;
    if (role === "textbox" && rawValue !== undefined && name === tidy(rawValue)) name = "";
    if (!name && FIELD_ROLES.has(role)) name = siblingLabel(n);
    name = clip(secrets.redact(name), 200);
    const token = desktopToken(n.ref, input.snapshotId);
    const value =
      role === "combobox" && n.selectedOption !== undefined
        ? redactNodeValue(n.selectedOption, undefined, false, secrets)
        : redactNodeValue(n.value, n.valueLength, n.secret, secrets);
    const bounds = n.bounds;
    const context = contextOf(n, anc, name);
    const description = n.description ? clip(secrets.redact(tidy(n.description)), 200) : undefined;
    const el: Element = {
      token,
      stableId: "",
      role,
      roleClass: roleClassOf(role),
      nativeRole: n.subrole ? `${n.role}/${n.subrole}` : n.role,
      name,
      ...(description ? { description } : {}),
      ...(value !== undefined ? { value } : {}),
      states: statesFor(role, n),
      actions: actionsFor(role, n),
      bounds,
      visibleBounds: bounds ? clipRect(bounds, snapshot.screen) : null,
      boundsTrust: bounds ? input.boundsTrust : "none",
      ...(n.automationId ? { automationId: n.automationId } : {}),
      ...(context ? { context } : {}),
      ...(n.options
        ? {
            options: n.options.map((o) => clip(secrets.redact(tidy(o)), 120)),
            optionCount: n.optionCount ?? n.options.length,
          }
        : {}),
      region: regionOf(n, anc),
      frame: "main",
      risk: riskFor(role, name, n),
    };
    if (el.actions.length === 0) continue;
    const base = `${idPrefix(platform)}:${role}:${slug(name)}`;
    const path = anc
      .map((a) => `${a.role}:${tidy(a.name)}`)
      .reverse()
      .join("/");
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
    pending.push({ el, base, path });
    refs.set(token, n.ref);
    if (n.secret) secretTokens.add(token);
    const region = windowRegion.get(n.window);
    if (region) sections.set(token, region.id);
    ancestors.set(
      token,
      anc.map((a) => a.ref),
    );
  }

  // Stable ids: the base when unique, else base + hash of the ancestor path (+ ordinal for exact twins).
  const seenPath = new Map<string, number>();
  for (const p of pending) {
    if ((baseCounts.get(p.base) ?? 0) <= 1) {
      p.el.stableId = p.base;
      elements.push(p.el);
      continue;
    }
    const key = `${p.base}|${p.path}`;
    const ord = seenPath.get(key) ?? 0;
    seenPath.set(key, ord + 1);
    p.el.stableId = `${p.base}:${hex4(`${p.path}#${ord}`)}`;
    elements.push(p.el);
  }

  const regions: RegionSummary[] = [...windowRegion.entries()].map(([, r]) => {
    const inRegion = elements.filter((e) => sections.get(e.token) === r.id);
    return {
      id: r.id,
      label: r.label,
      kind: r.kind,
      elementCount: inRegion.length,
      sample: inRegion
        .filter((e) => e.name)
        .slice(0, 4)
        .map((e) => e.name),
    };
  });

  return {
    elements,
    refs,
    secretTokens,
    sections,
    ancestors,
    text: clip(secrets.redact(texts.join("\n")), MAX_TEXT_CHARS),
    regions,
  };
}

// ---- ranking and caps (same policy as the web driver) ---------------------------------------------------

const REGION_RANK: Record<Region, number> = {
  dialog: 0,
  form: 1,
  main: 1,
  aside: 2,
  header: 3,
  nav: 3,
  other: 4,
  footer: 5,
};
const INTERACTIVE = new Set(["press", "set_value", "toggle", "select_option"]);
export const isInteractive = (el: Element): boolean => el.actions.some((a) => INTERACTIVE.has(a));

export function estimateTableTokens(elements: Element[], text: string): number {
  return estimateTokens(elements.map(renderElement)) + Math.ceil(Math.min(text.length, 2400) / 3);
}

export interface CapResult {
  elements: Element[];
  narrowed: boolean;
  tokenEstimate: number;
  omitted: number;
}

/** Keeps the best-ranked `maxElements` (open dialogs first) in tree order, then trims to the token guard. */
export function capElements(
  elements: Element[],
  text: string,
  maxElements = DEFAULT_MAX_ELEMENTS,
  maxTokens = DEFAULT_MAX_TOKENS,
): CapResult {
  const ranked = elements
    .map((el, i) => ({
      el,
      i,
      s:
        REGION_RANK[el.region] * 10 + (isInteractive(el) ? 0 : 3) + (el.states.includes("offscreen") ? 2 : 0),
    }))
    .sort((a, b) => a.s - b.s || a.i - b.i);
  let keep = ranked.slice(0, maxElements);
  const inOrder = () => [...keep].sort((a, b) => a.i - b.i).map((x) => x.el);
  let kept = inOrder();
  let tokens = estimateTableTokens(kept, text);
  let narrowed = false;
  while (tokens > maxTokens && keep.length > 1) {
    narrowed = true;
    keep = keep.slice(0, Math.max(1, Math.floor(keep.length * 0.85)));
    kept = inOrder();
    tokens = estimateTableTokens(kept, text);
  }
  return { elements: kept, narrowed, tokenEstimate: tokens, omitted: elements.length - kept.length };
}

export function measureQuality(elements: Element[]): SurfaceQuality {
  const interactive = elements.filter(isInteractive);
  const unnamed = interactive.filter((e) => e.name.trim().length === 0).length;
  const score = interactive.length === 0 ? 0 : (interactive.length - unnamed) / interactive.length;
  return {
    elementCount: elements.length,
    unnamedInteractive: unnamed,
    score: Math.round(score * 1000) / 1000,
  };
}
