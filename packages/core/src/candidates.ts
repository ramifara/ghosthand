// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Picks and ranks the elements offered to the decision model for each operation.
import type { Element, ElementAction, Region, Snapshot } from "@ghosthand/protocol";
import { focusHits } from "./focus-terms.ts";

/** Operations the loop can offer to Jev in mode B. */
export const OPERATIONS = [
  "press",
  "set_value",
  "toggle",
  "select_option",
  "select_text",
  "drag",
  "context_menu",
  "scroll",
] as const;
export type Operation = (typeof OPERATIONS)[number];

/** Scroll candidates: the last elements in document order (the end of the list or feed to scroll). */
export const MAX_SCROLL_CANDIDATES = 40;
/** Drop zones for a drag (second head). */
export const DROP_HEAD = "drop_target";

export const MAX_CANDIDATES_PER_HEAD = 200;

const REGION_RANK: Record<Region, number> = {
  dialog: 0,
  form: 1,
  main: 2,
  aside: 3,
  header: 4,
  nav: 5,
  other: 6,
  footer: 7,
};

const OPERATION_ACTION: Record<Exclude<Operation, "scroll">, ElementAction> = {
  press: "press",
  set_value: "set_value",
  toggle: "toggle",
  select_option: "select_option",
  select_text: "select_text",
  drag: "drag",
  context_menu: "context_menu",
};

export const isNamed = (el: Element): boolean => el.name.trim().length > 0;

export const isActionable = (el: Element): boolean =>
  !el.states.includes("disabled") && !el.states.includes("hidden") && !el.states.includes("readonly");

/** True when an open dialog exists; then only dialog elements are offered (modal semantics). */
export const hasOpenDialog = (snapshot: Snapshot): boolean =>
  snapshot.elements.some((e) => e.region === "dialog");

export interface RankOptions {
  /** Element names the planner expects; matching elements rank first within their region. */
  seedTargets?: string[];
  /** stableIds tried on this screen without effect; ranked last. */
  triedHere?: Set<string>;
  /** Candidates per head (default MAX_CANDIDATES_PER_HEAD); lower when a request must fit a context limit. */
  maxPerHead?: number;
  /** Goal words (focus-terms.ts): elements naming more of them rank first, so a cap never cuts them. */
  focusTerms?: readonly string[];
}

export function rankElements(elements: Element[], opts: RankOptions = {}): Element[] {
  const seeds = (opts.seedTargets ?? []).map((s) => s.toLowerCase());
  const score = (el: Element): number => {
    let s = REGION_RANK[el.region] * 10;
    if (seeds.some((seed) => el.name.toLowerCase().includes(seed))) s -= 5;
    if (opts.triedHere?.has(el.stableId)) s += 100;
    if (el.states.includes("offscreen")) s += 2;
    return s;
  };
  const terms = opts.focusTerms ?? [];
  const tried = (el: Element) => (opts.triedHere?.has(el.stableId) ? 1 : 0);
  // Tried-without-effect last, then more goal words first, then region and visibility; stable sort keeps
  // document order within equal scores.
  return elements
    .map((el, i) => ({ el, i, t: tried(el), h: focusHits(el, terms), s: score(el) }))
    .sort((a, b) => a.t - b.t || b.h - a.h || a.s - b.s || a.i - b.i)
    .map((x) => x.el);
}

/** Candidates per operation, plus drop zones for `drag` (offered only together with a drag source). */
export type CandidateTable = Record<Operation, Element[]> & { drop: Element[] };

/** A table with no candidates for any operation. */
export function emptyCandidates(): CandidateTable {
  const table = { drop: [] } as unknown as CandidateTable;
  for (const op of OPERATIONS) table[op] = [];
  return table;
}

export function buildCandidates(snapshot: Snapshot, opts: RankOptions = {}): CandidateTable {
  const dialog = hasOpenDialog(snapshot);
  const pool = snapshot.elements.filter((el) => isActionable(el) && (!dialog || el.region === "dialog"));
  // Goal words decide which candidates survive the per-head cap; the survivors are offered in the usual
  // order (region, visibility, document), because Jev weighs earlier options more and a goal-ordered list
  // pulls it towards rows that merely mention the goal.
  const ranked = rankElements(pool, opts);
  const usual = new Map(rankElements(pool, { ...opts, focusTerms: [] }).map((el, i) => [el.token, i]));
  const inUsualOrder = (els: Element[]) =>
    els.sort((a, b) => (usual.get(a.token) ?? 0) - (usual.get(b.token) ?? 0));
  const perHead = Math.min(opts.maxPerHead ?? MAX_CANDIDATES_PER_HEAD, MAX_CANDIDATES_PER_HEAD);
  const table = {} as CandidateTable;
  for (const op of OPERATIONS) {
    if (op === "scroll") continue;
    table[op] = inUsualOrder(
      ranked.filter((el) => el.actions.includes(OPERATION_ACTION[op])).slice(0, perHead),
    );
  }
  table.drop = inUsualOrder(ranked.filter((el) => el.actions.includes("drop")).slice(0, perHead));
  // A drag needs somewhere to drop.
  if (table.drop.length === 0) table.drag = [];
  // Scrolling is offered only when the driver says it reveals content missing from the table. Targets
  // are the last elements in document order (Jev picks one inside the list or feed to scroll).
  table.scroll =
    snapshot.canScroll === true
      ? pool.filter((el) => !el.states.includes("hidden")).slice(-MAX_SCROLL_CANDIDATES)
      : [];
  return table;
}

export function findByToken(snapshot: Snapshot, token: string): Element | undefined {
  return snapshot.elements.find((e) => e.token === token);
}
