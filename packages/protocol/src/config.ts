// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { z } from "zod";
import { BrowserBehavior } from "./browser-behavior.ts";
import { BrowserNetwork } from "./browser-network.ts";
import { Budget, DEFAULT_BUDGET } from "./task.ts";

/** Carriers for Jev: TypeSafe direct, OpenRouter, Vercel AI Gateway. */
export const DecisionCarrier = z.enum(["typesafe", "openrouter", "vercel"]);
export type DecisionCarrier = z.infer<typeof DecisionCarrier>;

/**
 * When a screenshot goes to Jev (ADR 0020): never; only for D0 grounding requests; or also with every
 * act, narrow and verify request.
 */
export const DecisionImages = z.enum(["off", "grounding", "always"]);
export type DecisionImages = z.infer<typeof DecisionImages>;

/** An env-file variable name (the key itself never goes in config). */
const EnvName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "an environment variable name");

export const GhostHandConfig = z.object({
  decision: z
    .object({
      provider: DecisionCarrier.default("typesafe"),
      /**
       * Model id on the carrier. Default per carrier: `jev-1.13.0` (TypeSafe), `typesafe/jev-1.13`
       * (OpenRouter), `typesafe-ai/jev` (Vercel).
       */
      model: z.string().optional(),
      /** Model for requests that carry an image or a box question. Default `jev-1.14.0` on TypeSafe. */
      visionModel: z.string().optional(),
      images: DecisionImages.default("grounding"),
      /** Env var holding the key. Default per carrier: TYPESAFE_API_KEY, OPENROUTER_API_KEY, AI_GATEWAY_API_KEY. */
      apiKeyEnv: EnvName.optional(),
      /**
       * Second carrier, asked only when the first fails with a rate limit, overload, server or network
       * error or a timeout. Skipped when its key is missing.
       */
      fallback: z
        .object({ provider: DecisionCarrier, model: z.string().optional(), apiKeyEnv: EnvName.optional() })
        .optional(),
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
      /** Text to type: the chosen literal must beat "none" by this much probability (set_value replaces). */
      text: z.number().min(0).max(1).default(0.5),
      /** A target this sure lets an advance action run when Jev splits between two operations. */
      sureTarget: z.number().min(0).max(1).default(0.9),
      /**
       * An advance action (a link, a tab: undone with Back) runs when its target is the most likely element,
       * beats "none", and has at least max(advanceTarget, advanceChoiceFactor / options) probability: the
       * demand scales with how many choices there were (ADR 0017). A wrong advance is backtracked.
       */
      advanceTarget: z.number().min(0).max(1).default(0.2),
      advanceChoiceFactor: z.number().min(0).default(1.5),
      /** A D0 box is used only when the paired presence noul is at least this likely. */
      boxPresent: z.number().min(0).max(1).default(0.7),
      /** A D0 box covering more of the image than this fraction is not a control. */
      boxMaxArea: z.number().min(0).max(1).default(0.25),
    })
    .prefault({}),
  browser: z
    .object({
      channel: z.enum(["auto", "chrome", "msedge", "brave", "chromium"]).default("auto"),
      headless: z.boolean().default(false),
      profile: z.string().default("default"),
      behavior: BrowserBehavior.prefault({}),
      network: BrowserNetwork.prefault({}),
      viewport: z
        .object({ width: z.number().int(), height: z.number().int() })
        .default({ width: 1280, height: 860 }),
    })
    .prefault({}),
  budget: Budget.default(DEFAULT_BUDGET),
  /** Origins always blocked for the agent (production systems). */
  blockedOrigins: z.array(z.string()).default([]),
  runsDir: z.string().optional(),
  models: z
    .object({
      /** Role bindings (`planner`, `writer`, …), parsed by @ghosthand/models. Default: per configured provider. */
      roles: z.record(z.string(), z.unknown()).optional(),
      /** Catalog overrides (vision flags, grounding conventions, prices), parsed by @ghosthand/models. */
      overrides: z.array(z.unknown()).optional(),
      /** Probe the loopback defaults (Ollama 127.0.0.1:11434, LM Studio 127.0.0.1:1234). */
      discoverLocal: z.boolean().default(true),
      /** More OpenAI-compatible servers (vLLM, llama.cpp server, …). Only these URLs are contacted. */
      local: z
        .array(
          z.object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase id, e.g. vllm"),
            baseUrl: z.url(),
            apiKeyEnv: EnvName.optional(),
          }),
        )
        .default([]),
    })
    .prefault({}),
  consultant: z
    .object({
      codex: z.object({ enabled: z.boolean().default(true), model: z.string().optional() }).prefault({}),
      /**
       * The user's own `claude` CLI. Opt-in: Anthropic's terms for subscription use by third-party
       * tools can change; an Anthropic API key is the recommended path (ADR 0007).
       */
      claude: z
        .object({
          enabled: z.boolean().default(false),
          model: z.string().optional(),
          binary: z.string().optional(),
        })
        .prefault({}),
    })
    .prefault({}),
});
export type GhostHandConfig = z.infer<typeof GhostHandConfig>;
export type GhostHandConfigInput = z.input<typeof GhostHandConfig>;
