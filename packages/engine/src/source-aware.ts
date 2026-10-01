// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Source-aware mode (research note §2.4, plan §3.4): for apps we build, the source map seeds the element
// ranking (names likely relevant to the subgoal on this route), gives the planner the route list and the
// current route's test ids and labels, and lets the run go straight to a route the goal names (no
// exploratory clicking). Source is a hint; the runtime page is the truth.

import {
  extractSourceMap,
  matchSourceRoute,
  plannerContext,
  type SourceMap,
  type SourceRoute,
  seedTargetsFor,
} from "@ghosthand/knowledge";
import type { Snapshot, Subgoal, TaskSpec } from "@ghosthand/protocol";
import type { AgentLoopExtras } from "./run-agent.ts";

const STOP = new Set(
  "a an the to and or of in on for my your our with then it is be this that from into at by as go open page screen please set save change".split(
    " ",
  ),
);
const words = (s: string): string[] =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(ings?|es|s)$/, "") : w));

/** Concrete routes (no params, no wildcard, not the index) a goal names by path or component. */
export function routeForGoal(map: SourceMap, goal: string): SourceRoute | undefined {
  const g = new Set(words(goal));
  let best: { route: SourceRoute; score: number } | undefined;
  let tie = false;
  for (const r of map.routes) {
    if (r.path === "/" || r.path.includes(":") || r.path.includes("*") || r.index) continue;
    const own = new Set([...words(r.path), ...words((r.component ?? "").replace(/Page$/, ""))]);
    let score = 0;
    for (const w of own) if (g.has(w)) score++;
    if (score === 0) continue;
    // Prefer shorter paths on ties of hits (the section itself over its sub-pages).
    const weighted = score * 10 - r.path.split("/").length;
    if (!best || weighted > best.score) {
      best = { route: r, score: weighted };
      tie = false;
    } else if (weighted === best.score) tie = true;
  }
  return best && !tie ? best.route : undefined;
}

export interface SourceAware {
  map: SourceMap;
  extras: AgentLoopExtras & { navigateFirst: (task: TaskSpec, start: Snapshot) => string | undefined };
}

/** Loop extras from a source map: seeds, planner context and route-first navigation. */
export function sourceAwareExtras(map: SourceMap, task: TaskSpec): SourceAware["extras"] {
  return {
    seedTargets: (subgoal: Subgoal, snapshot: Snapshot) =>
      seedTargetsFor(map, { url: snapshot.url ?? task.startUrl, goal: subgoal.goal }),
    plannerContext: plannerContext(map, task.startUrl),
    navigateFirst: (t: TaskSpec, start: Snapshot) => {
      const target = routeForGoal(map, t.instruction);
      if (!target || !start.url) return undefined;
      // Conservative: only from the app's home page, where the first step would be exploratory clicking.
      // A task that starts on a section already stands where the author put it.
      const here = matchSourceRoute(map, start.url);
      if (here?.path !== "/") return undefined;
      try {
        return new URL(target.path, start.url).href;
      } catch {
        return undefined;
      }
    },
  };
}

/** Extracts the source map of `dir` (e.g. apps/testbed/web/src). */
export async function loadSourceAware(dir: string, task: TaskSpec) {
  const map = await extractSourceMap(dir);
  if (!map.ok) return map;
  return { ok: true as const, value: { map: map.value, extras: sourceAwareExtras(map.value, task) } };
}
