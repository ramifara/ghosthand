// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Dialogue state for pointing words (research note voice-mode.md §2 "Deixis and dialogue state").
// Elements are remembered by stableId so they survive re-snapshots; tokens are looked up fresh.
import type { Deixis, Element, Snapshot } from "@ghosthand/protocol";

export interface FocusSnapshot {
  highlighted?: string;
  lastActed?: string;
  mentioned: string[];
  lastChoice?: { chosen: string; ranked: string[] };
  badges: Array<[number, string]>;
}

export class FocusStack {
  #highlighted: string | undefined;
  #lastActed: string | undefined;
  /** Candidates last shown or offered, in display order. */
  #mentioned: string[] = [];
  /** Last target choice, best first (for "the other one"). */
  #lastChoice: { chosen: string; ranked: string[] } | undefined;
  /** Number badges currently on screen. */
  #badges = new Map<number, string>();

  /** The overlay pulse / hover target. */
  highlight(el: Element | undefined): void {
    this.#highlighted = el?.stableId;
  }

  acted(el: Element): void {
    this.#lastActed = el.stableId;
    this.#highlighted = el.stableId;
  }

  mention(els: readonly Element[]): void {
    this.#mentioned = els.map((e) => e.stableId);
  }

  /** Records a target choice; `ranked` is best-first and includes the chosen element. */
  recordChoice(chosen: Element, ranked: readonly Element[]): void {
    const ids = ranked.map((e) => e.stableId);
    if (!ids.includes(chosen.stableId)) ids.unshift(chosen.stableId);
    this.#lastChoice = { chosen: chosen.stableId, ranked: ids };
  }

  /** Numbers the given elements 1..n (Voice Access style) and remembers them as mentioned. */
  showBadges(els: readonly Element[]): Map<number, Element> {
    this.#badges = new Map(els.map((e, i) => [i + 1, e.stableId]));
    this.mention(els);
    return new Map(els.map((e, i) => [i + 1, e]));
  }

  hideBadges(): void {
    this.#badges.clear();
  }

  get badgesShown(): boolean {
    return this.#badges.size > 0;
  }

  snapshot(): FocusSnapshot {
    return {
      ...(this.#highlighted ? { highlighted: this.#highlighted } : {}),
      ...(this.#lastActed ? { lastActed: this.#lastActed } : {}),
      mentioned: [...this.#mentioned],
      ...(this.#lastChoice ? { lastChoice: { ...this.#lastChoice } } : {}),
      badges: [...this.#badges],
    };
  }

  /** Element behind badge `n` in the current snapshot. */
  badge(n: number, snapshot: Snapshot): Element | undefined {
    const id = this.#badges.get(n);
    return id ? byStableId(snapshot, id) : undefined;
  }

  /** Mentioned elements still present in the snapshot, in mention order. */
  mentioned(snapshot: Snapshot): Element[] {
    return this.#mentioned.map((id) => byStableId(snapshot, id)).filter((e): e is Element => e !== undefined);
  }

  /** Resolves a pointing word against the snapshot; undefined when the focus has no answer. */
  resolveDeixis(deixis: Deixis, snapshot: Snapshot, siblings: readonly Element[] = []): Element | undefined {
    const find = (id: string | undefined) => (id ? byStableId(snapshot, id) : undefined);
    switch (deixis) {
      case "this":
      case "that":
      case "it":
        return find(this.#highlighted) ?? find(this.#lastActed);
      case "other": {
        const choice = this.#lastChoice;
        if (choice) {
          for (const id of choice.ranked) if (id !== choice.chosen && find(id)) return find(id);
        }
        const set = this.mentioned(snapshot);
        if (set.length === 2) return set.find((e) => e.stableId !== this.#lastActed);
        return undefined;
      }
      case "next":
      case "previous": {
        const anchor = this.#lastActed ?? this.#highlighted;
        const set = this.mentioned(snapshot);
        const list = set.length > 1 ? set : [...siblings];
        const at = list.findIndex((e) => e.stableId === anchor);
        if (at < 0) return undefined;
        return list[deixis === "next" ? at + 1 : at - 1];
      }
    }
  }
}

export const byStableId = (snapshot: Snapshot, id: string): Element | undefined =>
  snapshot.elements.find((e) => e.stableId === id);
