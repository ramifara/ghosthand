// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { z } from "zod";
import { Budget, DEFAULT_BUDGET } from "./task.ts";

export const GhostHandConfig = z.object({
  decision: z
    .object({
      provider: z.literal("typesafe").default("typesafe"),
      model: z.string().default("jev-1.13.0"),
      timeoutMs: z.number().int().positive().default(2500),
      retries: z.number().int().min(0).max(3).default(1),
      baseUrl: z.string().optional(),
      /** USD per million input tokens. */
      priceInputPerM: z.number().nonnegative().default(0.042),
    })
    .prefault({}),
  gates: z
    .object({
      operation: z.number().min(0).max(1).default(0.65),
      target: z.number().min(0).max(1).default(0.7),
      stuck: z.number().min(0).max(1).default(0.85),
    })
    .prefault({}),
  browser: z
    .object({
      channel: z.enum(["auto", "chrome", "msedge", "brave", "chromium"]).default("auto"),
      headless: z.boolean().default(false),
      profile: z.string().default("default"),
      viewport: z
        .object({ width: z.number().int(), height: z.number().int() })
        .default({ width: 1280, height: 860 }),
    })
    .prefault({}),
  budget: Budget.default(DEFAULT_BUDGET),
  /** Origins always blocked for the agent (production systems). */
  blockedOrigins: z.array(z.string()).default([]),
  runsDir: z.string().optional(),
  consultant: z
    .object({
      codex: z.object({ enabled: z.boolean().default(true), model: z.string().optional() }).prefault({}),
    })
    .prefault({}),
});
export type GhostHandConfig = z.infer<typeof GhostHandConfig>;
export type GhostHandConfigInput = z.input<typeof GhostHandConfig>;
