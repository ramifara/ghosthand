// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Evaluates done_when predicates: deterministic checks on the snapshot first, then the oracle,
// then a separate Jev "holds" request. The model's own "done" is never the verdict.
import type {
  DecisionProvider,
  DoneWhen,
  Entry,
  Predicate,
  PredicateResult,
  Snapshot,
  VerifyState,
} from "@ghosthand/protocol";
import { holdsQuestion } from "./questions.ts";

export const HOLDS_PASS = 0.7;
export const HOLDS_FAIL = 0.3;

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

export function urlMatches(url: string | undefined, pattern: string): boolean {
  if (!url) return false;
  if (pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/")) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(url);
    } catch {
      return false;
    }
  }
  if (pattern.startsWith("/")) {
    let path: string;
    try {
      const u = new URL(url);
      path = u.pathname + (pattern.includes("?") ? u.search : "");
    } catch {
      return false;
    }
    const strip = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
    if (pattern.includes("*")) {
      const re = new RegExp(`^${pattern.split("*").map(escapeRe).join(".*")}$`);
      return re.test(path);
    }
    return strip(path) === strip(pattern);
  }
  return url.startsWith(pattern);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Deterministic predicates against a snapshot; returns undefined for kinds that need an oracle or model. */
export function evaluateDeterministic(p: Predicate, snapshot: Snapshot): VerifyState | undefined {
  switch (p.kind) {
    case "url":
      return urlMatches(snapshot.url, p.matches) ? "satisfied" : "unsatisfied";
    case "visible": {
      const name = norm(p.name);
      const hit = snapshot.elements.some(
        (e) =>
          norm(e.name) === name &&
          (p.role === undefined || e.role === p.role) &&
          !e.states.includes("hidden"),
      );
      if (hit) return "satisfied";
      // Non-interactive text (headings, alerts) lives in snapshot.text.
      return p.role === undefined && norm(snapshot.text).includes(name) ? "satisfied" : "unsatisfied";
    }
    case "text": {
      const t = norm(p.text);
      const inText = norm(snapshot.text).includes(t);
      const inNames = snapshot.elements.some(
        (e) => norm(e.name).includes(t) || norm(e.context ?? "").includes(t),
      );
      return inText || inNames ? "satisfied" : "unsatisfied";
    }
    case "value": {
      const el = snapshot.elements.find((e) => norm(e.name) === norm(p.name));
      if (!el) return "unsatisfied";
      return (el.value ?? "") === p.value ? "satisfied" : "unsatisfied";
    }
    default:
      return undefined;
  }
}

export interface DoneWhenDeps {
  decision?: DecisionProvider;
  /** Testbed/control-API oracle; returns pass or fail, or undefined when unavailable. */
  oracle?: (taskId: string) => Promise<boolean | undefined>;
  /** Evaluates `http` predicates (API/DB checks) outside the page. */
  http?: (p: Extract<Predicate, { kind: "http" }>) => Promise<boolean | undefined>;
  /** Vision reviewer for model predicates the decision model left inconclusive. */
  vision?: (
    criteria: string,
    signal?: AbortSignal,
  ) => Promise<{ state: VerifyState; detail?: string; costUsd?: number }>;
  /** Rendered state for model checks (built by the loop). */
  state?: Entry;
  signal?: AbortSignal;
}

export interface DoneWhenResult {
  state: VerifyState;
  decidedBy: "deterministic" | "oracle" | "decision" | "vision" | "none";
  predicates: PredicateResult[];
  costUsd: number;
  decisionCalls: number;
}

/** Order: deterministic → oracle → model. Stops early once the outcome is settled. */
export async function evaluateDoneWhen(
  doneWhen: DoneWhen,
  snapshot: Snapshot,
  deps: DoneWhenDeps = {},
): Promise<DoneWhenResult> {
  const results: PredicateResult[] = [];
  let decidedBy: DoneWhenResult["decidedBy"] = "none";
  let costUsd = 0;
  let decisionCalls = 0;

  if (doneWhen.all.length === 0 && doneWhen.none.length === 0) {
    return { state: "unknown", decidedBy, predicates: results, costUsd, decisionCalls };
  }

  // "none" predicates are only deterministic (error banners etc.); a hit means not done.
  for (const p of doneWhen.none) {
    const s = evaluateDeterministic(p, snapshot);
    const inverted: VerifyState =
      s === "satisfied" ? "unsatisfied" : s === "unsatisfied" ? "satisfied" : "unknown";
    results.push({ predicate: p, state: inverted, detail: "none-predicate" });
    if (s === "satisfied")
      return {
        state: "unsatisfied",
        decidedBy: "deterministic",
        predicates: results,
        costUsd,
        decisionCalls,
      };
  }

  const pending: Predicate[] = [];
  for (const p of doneWhen.all) {
    const s = evaluateDeterministic(p, snapshot);
    if (s === undefined) {
      pending.push(p);
      continue;
    }
    results.push({ predicate: p, state: s });
    decidedBy = "deterministic";
    if (s === "unsatisfied")
      return { state: "unsatisfied", decidedBy, predicates: results, costUsd, decisionCalls };
  }

  for (const p of pending) {
    if (p.kind === "http") {
      const pass = deps.http ? await deps.http(p) : undefined;
      const s: VerifyState = pass === undefined ? "unknown" : pass ? "satisfied" : "unsatisfied";
      results.push({ predicate: p, state: s, ...(pass === undefined ? { detail: "no http checker" } : {}) });
      if (pass !== undefined && decidedBy !== "oracle") decidedBy = "deterministic";
      if (s === "unsatisfied")
        return { state: s, decidedBy: "deterministic", predicates: results, costUsd, decisionCalls };
      continue;
    }
    if (p.kind === "oracle") {
      const pass = deps.oracle ? await deps.oracle(p.taskId) : undefined;
      const s: VerifyState = pass === undefined ? "unknown" : pass ? "satisfied" : "unsatisfied";
      results.push({ predicate: p, state: s });
      if (pass !== undefined) decidedBy = "oracle";
      if (s === "unsatisfied") return { state: s, decidedBy, predicates: results, costUsd, decisionCalls };
      continue;
    }
    if (p.kind === "model") {
      if (!deps.decision || deps.state === undefined) {
        results.push({ predicate: p, state: "unknown", detail: "no decision provider" });
        continue;
      }
      const r = await deps.decision.ask(
        deps.state,
        { holds: holdsQuestion(p.criteria) },
        deps.signal ? { signal: deps.signal } : {},
      );
      decisionCalls++;
      if (!r.ok) {
        results.push({ predicate: p, state: "unknown", detail: `${r.error.kind}: ${r.error.message}` });
        continue;
      }
      costUsd += r.value.costUsd;
      const a = r.value.answers.holds;
      const prob = a?.type === "noul" ? a.p : undefined;
      let s: VerifyState =
        prob === undefined
          ? "unknown"
          : prob >= HOLDS_PASS
            ? "satisfied"
            : prob <= HOLDS_FAIL
              ? "unsatisfied"
              : "unknown";
      let detail = prob === undefined ? "abstain" : `p=${prob.toFixed(3)}`;
      let by: DoneWhenResult["decidedBy"] = "decision";
      // Inconclusive (or visual) checks go to the vision reviewer when one is configured.
      if (s === "unknown" && deps.vision) {
        const v = await deps.vision(p.criteria, deps.signal);
        costUsd += v.costUsd ?? 0;
        s = v.state;
        detail = `${detail}; vision: ${v.detail ?? v.state}`;
        by = "vision";
      }
      results.push({ predicate: p, state: s, detail });
      decidedBy = decidedBy === "none" || by === "vision" ? by : decidedBy;
      if (s === "unsatisfied")
        return { state: s, decidedBy: by, predicates: results, costUsd, decisionCalls };
    }
  }

  const all = results.filter((r) => r.detail !== "none-predicate");
  const state: VerifyState = all.every((r) => r.state === "satisfied") ? "satisfied" : "unknown";
  return { state, decidedBy, predicates: results, costUsd, decisionCalls };
}

export const hasDeterministicPredicates = (d: DoneWhen): boolean => d.all.some((p) => p.kind !== "model");
