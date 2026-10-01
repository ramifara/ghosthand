// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Shared `run`/`eval` setup for Phase 3: knowledge (recipes, learning), vision (modes D1/D2) and
// source-aware mode (seeding, planner context, route-first navigation).
import { resolve } from "node:path";
import type { VisionAssist } from "@ghosthand/core";
import {
  type AgentLoopExtras,
  type EngineRuntime,
  type KnowledgeOptions,
  openKnowledgeFor,
  setupVision,
  sourceAwareExtras,
} from "@ghosthand/engine";
import { extractSourceMap, type Knowledge, type SourceMap } from "@ghosthand/knowledge";
import type { TaskSpec } from "@ghosthand/protocol";

export interface ExtrasFlags {
  /** Learn recipes and the app map from verified runs. */
  learn: boolean;
  /** Use verified recipes (mode A). */
  recipes: "auto" | "off";
  /** Source directory of the app under test (source-aware mode). */
  source?: string;
  /** Modes D1/D2 when a vision provider is configured. */
  vision: "auto" | "off";
}

export interface RunExtras {
  knowledge?: KnowledgeOptions;
  vision?: VisionAssist;
  sourceMap?: SourceMap;
  /** One line for stderr, e.g. "recipes on · learning off · vision: none (no key) · source-aware". */
  describe: string;
  loopFor(task: TaskSpec): AgentLoopExtras | undefined;
  close(): void;
}

export async function setupRunExtras(
  rt: EngineRuntime,
  flags: ExtrasFlags,
): Promise<{ ok: true; value: RunExtras } | { ok: false; error: string }> {
  let kb: Knowledge | undefined;
  if (flags.learn || flags.recipes === "auto") kb = openKnowledgeFor(rt);
  const knowledge: KnowledgeOptions | undefined = kb
    ? { kb, learn: flags.learn, recipes: flags.recipes === "auto" }
    : undefined;
  let vision: VisionAssist | undefined;
  let visionNote = "vision off";
  if (flags.vision === "auto") {
    const v = await setupVision(rt);
    vision = v.vision;
    visionNote = v.vision ? `vision ${v.vision.id}` : `vision: none (${v.reason ?? "unavailable"})`;
  }
  let sourceMap: SourceMap | undefined;
  if (flags.source) {
    const m = await extractSourceMap(resolve(flags.source));
    if (!m.ok) return { ok: false, error: `source map of ${flags.source}: ${m.error.kind}` };
    sourceMap = m.value;
  }
  const parts = [
    `recipes ${knowledge?.recipes ? "on" : "off"}`,
    `learning ${knowledge?.learn ? "on" : "off"}`,
    visionNote,
    sourceMap
      ? `source-aware (${sourceMap.routes.length} routes, ${sourceMap.elements.length} elements)`
      : "blind",
  ];
  return {
    ok: true,
    value: {
      ...(knowledge ? { knowledge } : {}),
      ...(vision ? { vision } : {}),
      ...(sourceMap ? { sourceMap } : {}),
      describe: parts.join(" · "),
      loopFor(task) {
        const extras: AgentLoopExtras = {
          ...(vision ? { vision } : {}),
          ...(sourceMap ? sourceAwareExtras(sourceMap, task) : {}),
        };
        return Object.keys(extras).length > 0 ? extras : undefined;
      },
      close() {
        kb?.close();
      },
    },
  };
}
