// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Turns before/after read-backs into an effect and evidence. Values in evidence are always redacted.
import type { Effect, Evidence } from "@ghosthand/protocol";
import type { PageState, TargetProbe } from "./in-page/page-types.ts";

/** Page-level read-back around an action. */
export interface PageObservation {
  url: string;
  state: PageState | undefined;
  navigations: number;
  jsDialogs: number;
  popups: number;
  requests: number;
}

export type TargetObservation = TargetProbe | "gone" | undefined;

export interface Assessment {
  effect: Effect;
  evidence: Evidence[];
}

const stateLabel = (v: boolean | "mixed" | undefined): string =>
  v === undefined ? "unset" : v === "mixed" ? "mixed" : String(v);

/** Evidence that the page itself changed: URL, navigation, dialogs, popups. Strong evidence. */
export function pageEvidence(
  before: PageObservation,
  after: PageObservation,
  redact: (s: string) => string,
): Evidence[] {
  const out: Evidence[] = [];
  if (before.url !== after.url)
    out.push({ kind: "url", before: redact(before.url), after: redact(after.url) });
  else if (after.navigations > before.navigations)
    out.push({ kind: "url", after: redact(after.url), detail: "reloaded" });
  if (after.popups > before.popups)
    out.push({ kind: "url", detail: `${after.popups - before.popups} popup(s) opened` });
  const dBefore = before.state?.dialogs;
  const dAfter = after.state?.dialogs;
  if (dBefore !== undefined && dAfter !== undefined && dBefore !== dAfter)
    out.push({
      kind: "dialog",
      before: String(dBefore),
      after: String(dAfter),
      detail: dAfter > dBefore ? "dialog opened" : "dialog closed",
    });
  if (after.jsDialogs > before.jsDialogs)
    out.push({ kind: "dialog", detail: "JavaScript dialog shown (dismissed)" });
  return out;
}

/** Weak evidence: DOM mutations anywhere and network requests. */
export function weakEvidence(before: PageObservation, after: PageObservation): Evidence[] {
  const out: Evidence[] = [];
  const m0 = before.state?.mutations;
  const m1 = after.state?.mutations;
  if (m0 !== undefined && m1 !== undefined && m1 > m0)
    out.push({ kind: "dom", detail: `${m1 - m0} DOM mutation(s)` });
  if (after.requests > before.requests)
    out.push({ kind: "network", detail: `${after.requests - before.requests} request(s)` });
  return out;
}

/** Evidence on the target: removed, state flags, value, content nearby. */
export function targetEvidence(
  before: TargetObservation,
  after: TargetObservation,
  redactValue: (v: string | undefined) => string,
): Evidence[] {
  if (before === undefined || before === "gone") return [];
  if (after === "gone") return [{ kind: "dom", detail: "target removed from the page" }];
  if (after === undefined) return [];
  const out: Evidence[] = [];
  for (const key of ["checked", "expanded", "selected", "pressed"] as const) {
    if (before[key] !== after[key])
      out.push({
        kind: "state",
        before: `${key}=${stateLabel(before[key])}`,
        after: `${key}=${stateLabel(after[key])}`,
      });
  }
  if (before.value !== after.value)
    out.push({ kind: "value", before: redactValue(before.value), after: redactValue(after.value) });
  if (before.nearHash !== after.nearHash)
    out.push({ kind: "dom", detail: "content near the target changed" });
  return out;
}

/** Strong evidence confirms; weak evidence alone is partial; nothing is a suspected no-op. */
export function assess(strong: Evidence[], weak: Evidence[]): Assessment {
  if (strong.length > 0) return { effect: "confirmed", evidence: [...strong, ...weak] };
  if (weak.length > 0) return { effect: "partial", evidence: weak };
  return { effect: "suspected_noop", evidence: [{ kind: "none", detail: "no observable change" }] };
}
