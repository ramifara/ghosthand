// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Planner, writer and grounder wiring: the user's own consultant CLIs (Codex; Claude when opted in)
// and/or the models layer (every provider with a key, plus reachable local servers).
import {
  createClaudeConsultant,
  createClaudePlanner,
  createCodexConsultant,
  createCodexPlanner,
} from "@ghosthand/consultants";
import { FallbackPlanner, type Planner, type Writer } from "@ghosthand/core";
import {
  createModelClient,
  createModelPlanner,
  createModelWriter,
  createVisionGrounder,
  type ModelClient,
  type VisionGrounder,
} from "@ghosthand/models";
import { type ModelsSetupOptions, setupModels } from "./model-providers.ts";
import type { EngineRuntime } from "./runtime.ts";

export type PlannerChoice = "auto" | "codex" | "claude" | "models" | "none";
export type WriterChoice = "auto" | "models" | "none";

/**
 * A models-layer client over every provider with a key and every reachable local server, or
 * undefined when there is none.
 */
export async function createModelsClient(
  rt: EngineRuntime,
  opts: ModelsSetupOptions = {},
): Promise<ModelClient | undefined> {
  const setup = await setupModels(rt, opts);
  for (const w of setup.warnings) rt.logger.warn({ pkg: "models" }, w);
  if (setup.keyed.length === 0 && setup.localProviders.length === 0) return undefined;
  return createModelClient({
    catalog: setup.catalog,
    providers: setup.registry,
    bindings: setup.bindings,
    logger: rt.logger.child({ pkg: "models" }),
  });
}

/** The `vision_grounder` role over the models layer (native computer tools where available). */
export async function createGrounder(
  rt: EngineRuntime,
  opts: ModelsSetupOptions = {},
): Promise<VisionGrounder | undefined> {
  const client = await createModelsClient(rt, opts);
  return client === undefined ? undefined : createVisionGrounder({ client });
}

export interface Assistants {
  planner?: Planner;
  writer?: Writer;
  /** Closes warm consultant sessions. */
  close(): Promise<void>;
  describe: string;
}

export async function createAssistants(
  rt: EngineRuntime,
  choice: { planner: PlannerChoice; writer: WriterChoice },
  opts: ModelsSetupOptions = {},
): Promise<Assistants> {
  const models =
    choice.planner === "none" && choice.writer === "none" ? undefined : await createModelsClient(rt, opts);
  const closers: Array<() => Promise<void>> = [];
  const parts: string[] = [];
  const consultantPlanners: Planner[] = [];

  const codexWanted =
    choice.planner === "codex" || (choice.planner === "auto" && rt.config.consultant.codex.enabled);
  if (codexWanted) {
    const consultant = createCodexConsultant();
    const probe = await consultant.probe();
    if (probe.installed && probe.auth !== "none") {
      const model = rt.config.consultant.codex.model;
      const p = createCodexPlanner(consultant, model === undefined ? {} : { model });
      closers.push(() => p.close());
      consultantPlanners.push(p);
    }
  }
  // Claude is opt-in even in auto mode (ADR 0007); an explicit `--planner claude` also enables it.
  const claudeWanted =
    choice.planner === "claude" || (choice.planner === "auto" && rt.config.consultant.claude.enabled);
  if (claudeWanted) {
    const { binary, model } = rt.config.consultant.claude;
    const consultant = createClaudeConsultant(binary === undefined ? {} : { binary });
    const probe = await consultant.probe();
    if (probe.installed && probe.auth !== "none") {
      const p = createClaudePlanner(consultant, model === undefined ? {} : { model });
      closers.push(() => p.close());
      consultantPlanners.push(p);
    }
  }
  const modelPlanner =
    models && (choice.planner === "models" || choice.planner === "auto")
      ? createModelPlanner(models)
      : undefined;
  const chain = [...consultantPlanners, ...(modelPlanner ? [modelPlanner] : [])];
  const planner = chain.reduceRight<Planner | undefined>(
    (next, p) => (next === undefined ? p : new FallbackPlanner(p, next)),
    undefined,
  );
  if (planner) parts.push(`planner ${planner.id}`);
  const writer = models && choice.writer !== "none" ? createModelWriter(models) : undefined;
  if (writer) parts.push(`writer ${writer.id}`);
  return {
    ...(planner ? { planner } : {}),
    ...(writer ? { writer } : {}),
    close: async () => {
      for (const c of closers) await c();
    },
    describe: parts.join(", ") || "Jev only",
  };
}
