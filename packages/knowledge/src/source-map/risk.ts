// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Risk pre-tags from handler names, labels and the "destructive" variant.
import type { SourceRisk } from "./source-map-schema.ts";

const DESTRUCTIVE = [
  "delete",
  "remove",
  "revoke",
  "destroy",
  "erase",
  "discard",
  "purge",
  "wipe",
  "deactivate",
];
const EXTERNAL = [
  "pay",
  "payment",
  "send",
  "publish",
  "purchase",
  "buy",
  "checkout",
  "transfer",
  "submitorder",
];

/** "deleteInvoice" / "Revoke API key" / "orders.delete" → ["delete", "invoice", ...]. */
export function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

function matches(word: string, stems: string[]): boolean {
  return stems.some((s) => word === s || (word.startsWith(s) && word.length - s.length <= 3));
}

export interface RiskInput {
  /** Handler names and literals from on* props. */
  handlers: string[];
  /** Accessible name, text, testid. */
  labels: string[];
  variant?: string | undefined;
}

export function riskOf(input: RiskInput): SourceRisk {
  const all = [...input.handlers, ...input.labels].flatMap(words);
  if (input.variant === "destructive" || all.some((w) => matches(w, DESTRUCTIVE))) return "destructive";
  if (all.some((w) => matches(w, EXTERNAL))) return "external";
  return "none";
}
