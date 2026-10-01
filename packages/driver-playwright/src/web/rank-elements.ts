// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Caps the element table (dialog > main > nav > footer), applies the size guard and measures quality.
// The core ranks candidates per question head; here we only decide what enters the snapshot, and keep
// document order for what does.
import { estimateTokens, renderElement } from "@ghosthand/core";
import type { Element, Region, SurfaceQuality } from "@ghosthand/protocol";

export const DEFAULT_MAX_ELEMENTS = 200;
export const DEFAULT_MAX_TOKENS = 20_000;
/** The core clips page text to this many characters in the state. */
const STATE_TEXT_CHARS = 2400;

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

const INTERACTIVE_ACTIONS = new Set([
  "press",
  "set_value",
  "toggle",
  "select_option",
  "drag",
  "drop",
  "context_menu",
]);

export const isInteractive = (el: Element): boolean => el.actions.some((a) => INTERACTIVE_ACTIONS.has(a));

/** Lower is better: open dialogs first, then main content; offscreen and context-only rows last within a region. */
export function rankScore(el: Element): number {
  let s = REGION_RANK[el.region] * 10;
  if (!isInteractive(el)) s += 3;
  if (el.states.includes("offscreen")) s += 2;
  return s;
}

export function estimateSnapshotTokens(elements: Element[], text: string): number {
  return estimateTokens(elements.map(renderElement)) + Math.ceil(Math.min(text.length, STATE_TEXT_CHARS) / 3);
}

export interface CapResult {
  elements: Element[];
  narrowed: boolean;
  tokenEstimate: number;
  /** Elements left out by the cap or the size guard. */
  omitted: number;
}

/** Keeps the best-ranked `maxElements` in document order; if still over `maxTokens`, trims further and flags it. */
export function capElements(
  elements: Element[],
  text: string,
  maxElements = DEFAULT_MAX_ELEMENTS,
  maxTokens = DEFAULT_MAX_TOKENS,
): CapResult {
  const ranked = elements
    .map((el, i) => ({ el, i, s: rankScore(el) }))
    .sort((a, b) => a.s - b.s || a.i - b.i);
  let keep = ranked.slice(0, maxElements);
  const inOrder = () => [...keep].sort((a, b) => a.i - b.i).map((x) => x.el);
  let kept = inOrder();
  let tokens = estimateSnapshotTokens(kept, text);
  let narrowed = false;
  while (tokens > maxTokens && keep.length > 1) {
    narrowed = true;
    keep = keep.slice(0, Math.max(1, Math.floor(keep.length * 0.85)));
    kept = inOrder();
    tokens = estimateSnapshotTokens(kept, text);
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
