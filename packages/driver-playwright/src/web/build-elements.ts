// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Joins aria nodes with their DOM facts into protocol `Element`s: redacted values, states, bounds in
// top-viewport coordinates, region, frame path, risk and a stable fingerprint.
import { fnv1a } from "@ghosthand/core";
import type { Element, ElementState, Rect, Region } from "@ghosthand/protocol";
import type { FlatNode } from "./aria-tree.ts";
import { actionsFor, hrefFor, riskFor, roleClassOf } from "./element-rules.ts";
import type { DomInfo } from "./in-page/page-types.ts";
import type { SecretScope } from "./secret-scope.ts";
import { redactFieldValue } from "./secret-scope.ts";

/** Options exposed per select or listbox (the core asks them in partitions of 64). */
export const MAX_OPTIONS = 1024;
const MAX_NAME_CHARS = 300;

/** Where a frame's content sits in the top viewport, and how to name it. */
export interface FrameGeometry {
  /** "main" or "main > <iframe label>" ... */
  path: string;
  offset: { x: number; y: number };
  /** Visible part of the frame in top-viewport coordinates (the whole viewport for the top document). */
  clip: Rect;
  /** Region of the iframe element in its parent (dialog wins over the frame's own regions). */
  region: Region | undefined;
  hidden: boolean;
  origin: string | undefined;
}

export interface BuildInput {
  nodes: FlatNode[];
  dom: Map<string, DomInfo | null>;
  frames: Map<string, FrameGeometry>;
  snapshotId: string;
  scope: SecretScope;
}

export const tokenFor = (ref: string, snapshotId: string): string => `${ref}${snapshotId}`;

const CHECKABLE = new Set(["checkbox", "switch", "radio", "menuitemcheckbox", "menuitemradio"]);

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

const round = (r: Rect): Rect => ({
  x: Math.round(r.x * 10) / 10,
  y: Math.round(r.y * 10) / 10,
  width: Math.max(0, Math.round(r.width * 10) / 10),
  height: Math.max(0, Math.round(r.height * 10) / 10),
});

function statesOf(node: FlatNode, dom: DomInfo | null, offscreen: boolean): ElementState[] {
  const s: ElementState[] = [];
  if (node.disabled || dom?.disabled) s.push("disabled");
  if (CHECKABLE.has(node.role)) {
    const checked = dom?.checked ?? node.checked;
    s.push(checked === "mixed" ? "mixed" : checked === true ? "checked" : "unchecked");
  }
  if (node.selected || dom?.selected === true) s.push("selected");
  if (dom?.expanded !== undefined) s.push(dom.expanded ? "expanded" : "collapsed");
  else if (node.expanded) s.push("expanded");
  if (node.pressed === true || dom?.pressed === true) s.push("pressed");
  if (node.active || dom?.focused) s.push("focused");
  if (dom?.required) s.push("required");
  if (node.invalid || dom?.invalid) s.push("invalid");
  if (dom?.readonly) s.push("readonly");
  if (offscreen) s.push("offscreen");
  return s;
}

function stableKey(node: FlatNode, dom: DomInfo | null, context: string | undefined, frame: string): string {
  const contextKey = (context ?? "").split(" · ")[0]?.slice(0, 40) ?? "";
  return [node.role, node.name.toLowerCase(), dom?.testId ?? "", contextKey.toLowerCase(), frame].join("|");
}

/** Builds elements in document order; hidden elements and elements in hidden frames are dropped. */
export function buildElements(input: BuildInput): Element[] {
  const { scope } = input;
  const out: Element[] = [];
  const seen = new Map<string, number>();
  for (const node of input.nodes) {
    const dom = input.dom.get(node.ref) ?? null;
    if (dom?.hidden) continue;
    const frame = input.frames.get(node.frameKey);
    if (frame?.hidden) continue;
    const offset = frame?.offset ?? { x: 0, y: 0 };

    let bounds: Rect | null = null;
    let boundsTrust: Element["boundsTrust"] = "none";
    if (dom) {
      bounds = round({ ...dom.rect, x: dom.rect.x + offset.x, y: dom.rect.y + offset.y });
      boundsTrust = "exact";
    } else if (node.box) {
      bounds = { ...node.box, x: node.box.x + offset.x, y: node.box.y + offset.y };
      boundsTrust = "approximate";
    }
    const clipped = bounds && frame ? intersect(bounds, frame.clip) : bounds;
    const visibleBounds = clipped ? round(clipped) : null;
    if (bounds && bounds.width === 0 && bounds.height === 0) boundsTrust = "none";
    const offscreen = visibleBounds === null;

    const name = scope.redact(node.name).slice(0, MAX_NAME_CHARS);
    const context = dom?.context ? scope.redact(dom.context) : undefined;
    const framePath = frame?.path ?? "main";
    const key = stableKey({ ...node, name }, dom, context, framePath);
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);

    const ownRegion: Region = dom?.region ?? "other";
    const region: Region =
      frame?.region === "dialog" ? "dialog" : ownRegion === "other" ? (frame?.region ?? "other") : ownRegion;
    const editable = node.role === "combobox" && (dom?.tag === "input" || dom?.tag === "textarea");
    const absoluteHref = dom?.href ?? node.url;
    const pageOrigin = frame?.origin;

    const actions = actionsFor({
      role: node.role,
      tag: dom?.tag ?? "",
      inputType: dom?.inputType,
      editable,
      pointer: node.pointer,
      drag: dom?.drag,
      drop: dom?.drop,
      menu: dom?.menu,
    });
    const roleClass = roleClassOf(node.role);
    const el: Element = {
      token: tokenFor(node.ref, input.snapshotId),
      stableId: `w${fnv1a(key)}${nth > 1 ? `-${nth}` : ""}`,
      role: node.role,
      // A drop zone (list, column, region) reads as a container, not as "other".
      roleClass: roleClass === "other" && actions[0] === "drop" ? "container" : roleClass,
      nativeRole: dom ? `${dom.tag}${dom.inputType ? `[type=${dom.inputType}]` : ""}` : "",
      name,
      states: statesOf(node, dom, offscreen),
      actions,
      bounds,
      visibleBounds,
      boundsTrust,
      region,
      frame: framePath,
      risk: riskFor({
        role: node.role,
        name,
        tag: dom?.tag ?? "",
        submits: dom?.submits ?? false,
        href: absoluteHref !== undefined ? resolveHref(absoluteHref, pageOrigin) : undefined,
        pageOrigin,
      }),
    };
    if (dom?.description) el.description = scope.redact(dom.description);
    else if (dom?.tag === "input" && dom.inputType === "file")
      el.description = "File upload: set its value to a file name to upload that file";
    const value = dom ? redactFieldValue(dom.value, dom, scope) : undefined;
    if (value !== undefined) el.value = value;
    if (dom?.testId) el.automationId = dom.testId;
    if (context) el.context = context;
    if (absoluteHref !== undefined) el.href = hrefFor(resolveHref(absoluteHref, pageOrigin), pageOrigin);
    const options = dom?.options ?? (node.optionNames.length > 0 ? node.optionNames : undefined);
    if (options) {
      el.options = options.slice(0, MAX_OPTIONS).map((o) => scope.redact(o));
      el.optionCount = dom?.optionCount ?? options.length;
    }
    out.push(el);
  }
  return out;
}

function resolveHref(href: string, origin: string | undefined): string {
  try {
    return new URL(href, origin ?? undefined).href;
  } catch {
    return href;
  }
}
