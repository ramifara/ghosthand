// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Screen fingerprints (research note §2.2, ADR 0010): what screen of an app is this, robust to dynamic ids,
// counters and user data. A fingerprint has
// - a URL pattern: origin + path with id-like segments templated (`/orders/:id`), query keys only;
// - landmarks: dialog title, h1-h3 headings and region kinds/labels, normalized (digits → #);
// - controls: the names of buttons, links, tabs, fields and menu items, normalized and capped.
// `key` (URL pattern + landmarks) identifies the screen; `similarity` compares control sets for fuzzy
// matches (the same screen with a few controls added or removed).
import type { Element, Snapshot } from "@ghosthand/protocol";
import { fnv1a } from "./stall.ts";

export interface ScreenFingerprint {
  /** Stable id of the screen: hash of the URL pattern and landmarks. */
  key: string;
  urlPattern: string;
  landmarks: string[];
  /** Normalized `role:name` of named controls, sorted, at most MAX_CONTROLS. */
  controls: string[];
}

export const MAX_CONTROLS = 60;
/** Two fingerprints with the same URL pattern and at least this control overlap are the same screen. */
export const SAME_SCREEN_SIMILARITY = 0.6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEXISH = /^[0-9a-f]{8,}$/i;
const NUMERIC = /^\d+$/;
/** Long tokens mixing letters and digits (slugs with ids, random ids). */
const MIXED_ID = /^(?=.*\d)(?=.*[a-z])[a-z0-9_-]{10,}$/i;
/** Order-style ids such as ORD-1042 or INV_2026_03. */
const CODE_ID = /^[a-z]{1,6}[-_]\d[\d_-]*$/i;

export function templateSegment(seg: string): string {
  if (seg === "") return seg;
  let decoded = seg;
  try {
    decoded = decodeURIComponent(seg);
  } catch {
    // keep the raw segment
  }
  if (NUMERIC.test(decoded)) return ":n";
  if (UUID.test(decoded) || HEXISH.test(decoded) || MIXED_ID.test(decoded) || CODE_ID.test(decoded))
    return ":id";
  return decoded.toLowerCase();
}

/** `http://127.0.0.1:4400/orders/ORD-1042?tab=notes&x=1#a` → `http://127.0.0.1:4400/orders/:id?tab&x`. */
export function urlPattern(url: string | undefined): string {
  if (!url) return "about:blank";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
  if (u.protocol === "about:" || u.protocol === "data:") return u.protocol;
  const path = u.pathname.split("/").map(templateSegment).join("/").replace(/\/+$/, "") || "/";
  const keys = [...new Set([...u.searchParams.keys()])].sort();
  return `${u.origin}${path}${keys.length > 0 ? `?${keys.join("&")}` : ""}`;
}

/** Lowercase, digits → #, whitespace collapsed, quotes and trailing punctuation dropped, capped. */
export function normalizeLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/["'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:!?…]+$/, "")
    .slice(0, 60);
}

const CONTROL_CLASSES = new Set<Element["roleClass"]>([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "select",
  "menuitem",
  "tab",
  "slider",
]);

/** Data-like names (emails, money, long numbers) say nothing about which screen this is. */
const DATA_LIKE = /@|[$€£]|^#+([.,]#+)*$/;

export function controlSignature(elements: readonly Element[]): string[] {
  const out = new Set<string>();
  for (const e of elements) {
    if (!CONTROL_CLASSES.has(e.roleClass) || e.states.includes("hidden")) continue;
    const name = normalizeLabel(e.name);
    if (name === "" || DATA_LIKE.test(name)) continue;
    out.add(`${e.roleClass}:${name}`);
  }
  return [...out].sort().slice(0, MAX_CONTROLS);
}

export function landmarkSignature(snapshot: Snapshot): string[] {
  const marks = new Set<string>();
  const dialog = snapshot.regions?.find((r) => r.kind === "dialog");
  if (dialog) marks.add(`dialog:${normalizeLabel(dialog.label)}`);
  else if (snapshot.elements.some((e) => e.region === "dialog")) marks.add("dialog:");
  for (const e of snapshot.elements) {
    if (e.roleClass !== "heading" || e.states.includes("hidden")) continue;
    const name = normalizeLabel(e.name);
    if (name !== "" && !DATA_LIKE.test(name)) marks.add(`h:${name}`);
    if (marks.size >= 8) break;
  }
  for (const r of snapshot.regions ?? []) {
    if (r.kind === "dialog" || r.kind === "section") continue;
    marks.add(`${r.kind}:${normalizeLabel(r.label)}`);
  }
  return [...marks].sort();
}

export function screenFingerprint(snapshot: Snapshot): ScreenFingerprint {
  const pattern = urlPattern(snapshot.url);
  const landmarks = landmarkSignature(snapshot);
  return {
    key: fnv1a(`${pattern}\n${landmarks.join("\n")}`),
    urlPattern: pattern,
    landmarks,
    controls: controlSignature(snapshot.elements),
  };
}

/** Jaccard overlap of the control sets (1 when both are empty). */
export function controlSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const sa = new Set(a);
  let inter = 0;
  for (const c of b) if (sa.has(c)) inter++;
  return inter / (sa.size + b.length - inter);
}

/** Same screen: same key, or the same URL pattern with similar controls. */
export function sameScreen(a: ScreenFingerprint, b: ScreenFingerprint): boolean {
  if (a.key === b.key) return true;
  return a.urlPattern === b.urlPattern && controlSimilarity(a.controls, b.controls) >= SAME_SCREEN_SIMILARITY;
}
