// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Effects from host read-backs. Same rule as the web driver: read-back evidence confirms, accessibility
// events alone are partial, nothing observable is a suspected no-op. Values in evidence are redacted.
import type { Effect, Evidence, RpcGlobalProbe, RpcProbe } from "@ghosthand/protocol";

export interface Assessment {
  effect: Effect;
  evidence: Evidence[];
}

const STATE_KEYS = ["checked", "pressed", "expanded", "selected", "indeterminate", "focused"] as const;

/** Strong evidence at window level: windows opened or closed, the active window changed, content changed. */
export function windowEvidence(
  before: RpcGlobalProbe,
  after: RpcGlobalProbe,
  redact: (s: string) => string,
): Evidence[] {
  const out: Evidence[] = [];
  const b = new Set(before.windows);
  const a = new Set(after.windows);
  const opened = [...a].filter((w) => !b.has(w));
  const closed = [...b].filter((w) => !a.has(w));
  const isDialog = (w: string) => /^(dialog|alert|file chooser|AXSheet|AXDialog|Window\/dialog)/i.test(w);
  if (opened.length > 0)
    out.push({
      kind: opened.some(isDialog) ? "dialog" : "state",
      detail: `window opened: ${redact(opened.join(", ")).slice(0, 160)}`,
    });
  if (closed.length > 0)
    out.push({
      kind: closed.some(isDialog) ? "dialog" : "state",
      detail: `window closed: ${redact(closed.join(", ")).slice(0, 160)}`,
    });
  if (opened.length === 0 && closed.length === 0 && before.activeWindow !== after.activeWindow)
    out.push({
      kind: "state",
      before: `active=${redact(before.activeWindow ?? "none")}`,
      after: `active=${redact(after.activeWindow ?? "none")}`,
    });
  if (
    before.contentHash !== undefined &&
    after.contentHash !== undefined &&
    before.contentHash !== after.contentHash
  )
    out.push({ kind: "dom", detail: "content of the active window changed" });
  return out;
}

/** Weak evidence: accessibility events and focus moves. */
export function weakEvidence(
  before: RpcGlobalProbe,
  after: RpcGlobalProbe,
  redact: (s: string) => string,
): Evidence[] {
  const out: Evidence[] = [];
  if (after.events > before.events)
    out.push({ kind: "dom", detail: `${after.events - before.events} accessibility event(s)` });
  if (before.focused !== after.focused)
    out.push({
      kind: "state",
      before: `focus=${redact(before.focused ?? "none")}`,
      after: `focus=${redact(after.focused ?? "none")}`,
    });
  return out;
}

const has = (p: RpcProbe, s: string): boolean => p.states.includes(s);

/** Evidence on the target: removed, state flags, value, selected option, name, children. */
export function targetEvidence(
  before: RpcProbe | null,
  after: RpcProbe | null,
  redactValue: (v: string | undefined) => string,
  redact: (s: string) => string,
): Evidence[] {
  if (before === null) return [];
  if (after === null) return [{ kind: "dom", detail: "target removed" }];
  const out: Evidence[] = [];
  for (const key of STATE_KEYS) {
    if (key === "focused") continue;
    if (has(before, key) !== has(after, key))
      out.push({ kind: "state", before: `${key}=${has(before, key)}`, after: `${key}=${has(after, key)}` });
  }
  if (before.value !== after.value)
    out.push({ kind: "value", before: redactValue(before.value), after: redactValue(after.value) });
  else if (before.valueLength !== after.valueLength)
    out.push({
      kind: "value",
      before: before.valueLength ? "<filled>" : "<empty>",
      after: after.valueLength ? "<filled>" : "<empty>",
    });
  if (before.selectedOption !== after.selectedOption)
    out.push({
      kind: "value",
      before: redact(before.selectedOption ?? "none"),
      after: redact(after.selectedOption ?? "none"),
      detail: "selected option",
    });
  if (before.name !== after.name)
    out.push({ kind: "state", before: `name=${redact(before.name)}`, after: `name=${redact(after.name)}` });
  if (
    before.childCount !== undefined &&
    after.childCount !== undefined &&
    before.childCount !== after.childCount
  )
    out.push({ kind: "dom", detail: `children ${before.childCount} → ${after.childCount}` });
  return out;
}

export function assess(strong: Evidence[], weak: Evidence[]): Assessment {
  if (strong.length > 0) return { effect: "confirmed", evidence: [...strong, ...weak] };
  if (weak.length > 0) return { effect: "partial", evidence: weak };
  return { effect: "suspected_noop", evidence: [{ kind: "none", detail: "no observable change" }] };
}
