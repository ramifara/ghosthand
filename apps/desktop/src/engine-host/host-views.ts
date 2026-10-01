// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Engine data → renderer view models. Pure, so the mapping (and what it leaves out) is tested.
import { join, win32 } from "node:path";
import type { CatalogModel } from "@ghosthand/models";
import { compatibleRoles } from "@ghosthand/models";
import type { ModelListItem, ProfileItem, RunListItem, TaskListItem } from "@ghosthand/protocol";
import type { RunRecord } from "@ghosthand/recorder";

/** Drops the folder path and git sha: the renderer addresses runs by id only. */
export function toRunListItem(r: RunRecord): RunListItem {
  return {
    id: r.id,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    taskId: r.taskId,
    instruction: r.instruction,
    startUrl: r.startUrl,
    outcome: r.outcome,
    reason: r.reason,
    steps: r.steps,
    wallMs: r.wallMs,
    costUsd: r.costUsd,
    decisionCalls: r.decisionCalls,
    modelCalls: r.modelCalls,
    decisionModel: r.decisionModel,
  };
}

export function toTaskListItem(t: {
  id: string;
  version: number;
  level: number;
  start: string;
  instruction: string;
}): TaskListItem {
  return { id: t.id, version: t.version, level: t.level, start: t.start, instruction: t.instruction };
}

export function toModelListItem(m: CatalogModel, access: ModelListItem["access"]): ModelListItem {
  return {
    ref: m.ref,
    name: m.name,
    provider: m.provider,
    contextTokens: m.contextTokens,
    ...(m.pricing ? { inputPerM: m.pricing.inputPerM, outputPerM: m.pricing.outputPerM } : {}),
    roles: compatibleRoles(m),
    computerUse: m.computerUse !== undefined,
    imageInput: m.inputModalities.includes("image"),
    structuredOutput: m.structuredOutput,
    reasoning: m.reasoning,
    access,
  };
}

export function toProfileItem(p: {
  name: string;
  sizeBytes?: number;
  lastUsedAt?: string;
  metadata?: { importedFrom?: string };
}): ProfileItem {
  return {
    name: p.name,
    sizeBytes: p.sizeBytes ?? 0,
    ...(p.lastUsedAt ? { lastUsedAt: p.lastUsedAt } : {}),
    ...(p.metadata?.importedFrom ? { importedFrom: p.metadata.importedFrom } : {}),
  };
}

/** Google Chrome's default user-data-dir per platform (for "import a Chrome profile"). */
export function defaultChromeUserDataDir(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  if (platform === "win32") {
    return win32.join(
      env.LOCALAPPDATA ?? win32.join(home, "AppData", "Local"),
      "Google",
      "Chrome",
      "User Data",
    );
  }
  if (platform === "darwin") return join(home, "Library", "Application Support", "Google", "Chrome");
  return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "google-chrome");
}
