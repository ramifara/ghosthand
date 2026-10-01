// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Code rules that must pass before an action runs. Deterministic checks override any model verdict.
import type { Answer, EffectClass, Element, ElementRisk, GateName } from "@ghosthand/protocol";
import { isNamed } from "./candidates.ts";

export interface GateThresholds {
  operation: number;
  target: number;
}

export interface GateResult {
  gate: GateName;
  passed: boolean;
  detail?: string;
}

const RISK_EFFECT: Record<ElementRisk, EffectClass> = {
  safe: "advance",
  navigates: "advance",
  submits: "commit",
  destructive: "commit",
  external: "commit",
  unknown: "advance",
};

const EFFECT_ORDER: Record<EffectClass, number> = { advance: 0, commit: 1, forbidden: 2 };

/** The stricter of the code-derived effect and the model's effect wins. */
export function combineEffect(
  element: Element | undefined,
  modelEffect: EffectClass | undefined,
): EffectClass {
  const code = element ? RISK_EFFECT[element.risk] : "advance";
  const model = modelEffect ?? "advance";
  return EFFECT_ORDER[model] > EFFECT_ORDER[code] ? model : code;
}

export const choiceConfidence = (a: Answer | undefined): number =>
  a?.type === "choice" ? (a.probabilities[a.choice] ?? a.confidence) : 0;

export interface GateInput {
  thresholds: GateThresholds;
  operation: Answer | undefined;
  target: Answer | undefined;
  element: Element | undefined;
  effect: EffectClass;
  allowedEffects: EffectClass[];
  snapshotFresh: boolean;
}

export function evaluateGates(input: GateInput): GateResult[] {
  const opConf = choiceConfidence(input.operation);
  const targetConf = choiceConfidence(input.target);
  const results: GateResult[] = [
    {
      gate: "operation_confidence",
      passed: opConf >= input.thresholds.operation,
      detail: `${opConf.toFixed(3)} vs ${input.thresholds.operation}`,
    },
    {
      gate: "target_confidence",
      passed: input.element !== undefined && targetConf >= input.thresholds.target,
      detail: input.element ? `${targetConf.toFixed(3)} vs ${input.thresholds.target}` : "no target",
    },
    {
      gate: "target_named",
      passed: input.element !== undefined && isNamed(input.element),
      detail: input.element ? `"${input.element.name}"` : "no target",
    },
    {
      gate: "effect_allowed",
      passed: input.effect !== "forbidden" && input.allowedEffects.includes(input.effect),
      detail: `${input.effect} in [${input.allowedEffects.join(",")}]`,
    },
    { gate: "snapshot_fresh", passed: input.snapshotFresh },
  ];
  return results;
}

export const allPassed = (results: GateResult[]): boolean => results.every((r) => r.passed);
