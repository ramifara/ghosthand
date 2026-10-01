// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Planner and writer wiring: the Codex consultant (user's own login) and/or the models layer (API key).
import { createCodexConsultant, createCodexPlanner } from "@ghosthand/consultants";
import { FallbackPlanner, type Planner, type Writer } from "@ghosthand/core";
import {
  createModelCatalog,
  createModelClient,
  createModelPlanner,
  createModelWriter,
  createOpenAIProvider,
  createProviderRegistry,
  type ModelClient,
} from "@ghosthand/models";
import { envValue } from "./env-file.ts";
import type { EngineRuntime } from "./runtime.ts";

export type PlannerChoice = "auto" | "codex" | "models" | "none";
export type WriterChoice = "auto" | "models" | "none";

/** A models-layer client when an OpenAI key is configured, else undefined. */
export function createModelsClient(rt: EngineRuntime): ModelClient | undefined {
  const apiKey = envValue("OPENAI_API_KEY", rt.envFile);
  if (!apiKey) return undefined;
  rt.secrets.register("OPENAI_API_KEY", apiKey);
  const catalog = createModelCatalog();
  if (!catalog.ok) return undefined;
  return createModelClient({
    catalog: catalog.value,
    providers: createProviderRegistry([createOpenAIProvider({ apiKey })]),
    logger: rt.logger.child({ pkg: "models" }),
  });
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
): Promise<Assistants> {
  const models = choice.planner === "none" && choice.writer === "none" ? undefined : createModelsClient(rt);
  const closers: Array<() => Promise<void>> = [];
  const parts: string[] = [];
  let codex: Planner | undefined;
  if (choice.planner === "codex" || choice.planner === "auto") {
    const consultant = createCodexConsultant();
    const probe = await consultant.probe();
    if (probe.installed && probe.auth !== "none") {
      const p = createCodexPlanner(consultant);
      closers.push(() => p.close());
      codex = p;
    }
  }
  const modelPlanner =
    models && (choice.planner === "models" || choice.planner === "auto")
      ? createModelPlanner(models)
      : undefined;
  const planner = codex && modelPlanner ? new FallbackPlanner(codex, modelPlanner) : (codex ?? modelPlanner);
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
