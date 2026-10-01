// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Stored recipe shape (ADR 0011). Values and plan texts may hold `{{name}}` parameter placeholders;
// secrets stay `{secretRef: NAME}` and are never stored by value.
import { Action, EffectClass, Plan } from "@ghosthand/protocol";
import { z } from "zod";

export const StoredTarget = z.object({
  stableId: z.string(),
  role: z.string(),
  name: z.string(),
  automationId: z.string().optional(),
});
export type StoredTarget = z.infer<typeof StoredTarget>;

export const StoredStep = z.object({
  action: Action,
  target: StoredTarget.nullable(),
  destination: StoredTarget.optional(),
  screen: z.object({ key: z.string(), urlPattern: z.string().optional() }).optional(),
  /** Screen key after the step (app-map transition). */
  to: z.string().optional(),
  effect: EffectClass,
});
export type StoredStep = z.infer<typeof StoredStep>;

export const RecipeParam = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  /** The literal seen when the recipe was learned. */
  example: z.string(),
});
export type RecipeParam = z.infer<typeof RecipeParam>;

export const RecipeStatus = z.enum(["active", "retired"]);
export type RecipeStatus = z.infer<typeof RecipeStatus>;

export const Recipe = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  /** App id: origin of the start URL. */
  app: z.string(),
  taskId: z.string().optional(),
  /** Instruction template; literals that became parameters appear as `{{name}}`. */
  intent: z.string().min(1),
  params: z.array(RecipeParam),
  startUrl: z.string(),
  startScreen: z.object({ key: z.string(), urlPattern: z.string() }),
  steps: z.array(StoredStep).min(1),
  /** The plan the learned run executed (with the same placeholders). */
  plan: Plan.optional(),
  secrets: z.array(z.string()),
  status: RecipeStatus,
  trust: z.number().min(0).max(1),
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  consecutiveFailures: z.number().int().nonnegative(),
  heals: z.number().int().nonnegative(),
  learnedFrom: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastSuccessAt: z.number().optional(),
});
export type Recipe = z.infer<typeof Recipe>;
