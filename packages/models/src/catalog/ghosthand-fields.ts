// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Fields models.dev lacks: native computer-use tool, grounding coordinate convention, measured latency.
// Built-in values come from docs/research/notes/model-layer.md §1 (vendor docs read 2026-09-30).
// Measured latency is empty until the eval harness fills it; users can override everything.
import { z } from "zod";

export const NativeComputerTool = z.enum([
  "openai_computer",
  "anthropic_toolset_20260801",
  "anthropic_computer_20251124",
  "gemini_computer_use",
]);
export type NativeComputerTool = z.infer<typeof NativeComputerTool>;

/**
 * How a model reports screen coordinates: screenshot `pixels`, a `norm1000` (0–1000) grid,
 * a `norm999` (0–999) grid (Gemini computer use), or `none` when unknown.
 */
export const GroundingConvention = z.enum(["pixels", "norm1000", "norm999", "none"]);
export type GroundingConvention = z.infer<typeof GroundingConvention>;

export interface GhostHandFields {
  readonly computerUse?: NativeComputerTool;
  readonly grounding?: GroundingConvention;
  /** Median latency in ms on our fixed screenshot + JSON prompt. */
  readonly latencyP50Ms?: number;
}

const openaiCu: GhostHandFields = { computerUse: "openai_computer", grounding: "pixels" };
const anthropicToolset: GhostHandFields = { computerUse: "anthropic_toolset_20260801", grounding: "pixels" };
const anthropicLegacy: GhostHandFields = { computerUse: "anthropic_computer_20251124", grounding: "pixels" };
const gemini: GhostHandFields = { computerUse: "gemini_computer_use", grounding: "norm999" };

/** Keyed by `provider/model`. Applies only to direct provider keys (OpenRouter passthrough is unverified). */
export const BUILTIN_GHOSTHAND_FIELDS: Readonly<Record<string, GhostHandFields>> = {
  "openai/gpt-6-astra": openaiCu,
  "openai/gpt-6.1-sol": openaiCu,
  "openai/gpt-5.5": openaiCu,
  "openai/gpt-5.4": openaiCu,
  "anthropic/claude-opus-5-5": anthropicToolset,
  "anthropic/claude-sonnet-5-5": anthropicToolset,
  "anthropic/claude-opus-5": anthropicToolset,
  "anthropic/claude-sonnet-5": anthropicToolset,
  "anthropic/claude-fable-5": anthropicToolset,
  "anthropic/claude-fable-5-1": anthropicToolset,
  "anthropic/claude-opus-4-8": anthropicToolset,
  "anthropic/claude-opus-4-7": anthropicLegacy,
  "anthropic/claude-opus-4-6": anthropicLegacy,
  "anthropic/claude-opus-4-5": anthropicLegacy,
  "anthropic/claude-sonnet-4-6": anthropicLegacy,
  "google/gemini-3.8-flash": gemini,
  "google/gemini-3.5-flash": gemini,
  "google/gemini-2.5-computer-use-preview-10-2025": gemini,
};
