// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Typed QA spec (Playwright Test Agents style Markdown, parsed by parse-spec.ts). Line numbers are 1-based.
import { z } from "zod";

/** Preflight classification of a step (cooper667/jev-playwright). Only `ok` steps are decisive. */
export const StepFlag = z.enum(["ok", "transient", "derived", "visual", "external"]);
export type StepFlag = z.infer<typeof StepFlag>;

export const QaExpect = z.object({ text: z.string().min(1), line: z.number().int().positive() });
export type QaExpect = z.infer<typeof QaExpect>;

export const QaStep = z.object({
  /** 1-based position in the case. */
  index: z.number().int().positive(),
  line: z.number().int().positive(),
  perform: z.string().min(1),
  expects: z.array(QaExpect),
  notes: z.array(z.string()),
});
export type QaStep = z.infer<typeof QaStep>;

/** Plan subgoals are capped at 12, and so are steps per case. */
export const MAX_STEPS_PER_CASE = 12;

export const QaCase = z.object({
  title: z.string().min(1),
  line: z.number().int().positive(),
  steps: z.array(QaStep).min(1).max(MAX_STEPS_PER_CASE),
  /** Expect lines outside any numbered step: judged once after the last step. */
  expects: z.array(QaExpect),
  notes: z.array(z.string()),
});
export type QaCase = z.infer<typeof QaCase>;

export const QaSuite = z.object({
  title: z.string().min(1),
  line: z.number().int().positive(),
  cases: z.array(QaCase).min(1),
  notes: z.array(z.string()),
});
export type QaSuite = z.infer<typeof QaSuite>;

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export const QaBudget = z.object({
  steps: z.number().int().positive().default(25),
  seconds: z.number().positive().default(180),
  usd: z.number().nonnegative().default(0.25),
});
export type QaBudget = z.infer<typeof QaBudget>;

/** Testbed setup: reset with a seed and variant, apply named seeds, sign in a user. */
export const QaTestbed = z.object({
  /** Reuse a testbed task's setup (seed, seeds, variant, login). */
  task: z.string().optional(),
  seed: z.number().int().nonnegative().optional(),
  seeds: z.array(z.string()).default([]),
  variant: z.record(z.string(), Scalar).default({}),
});
export type QaTestbed = z.infer<typeof QaTestbed>;

export const QaFrontMatter = z
  .object({
    /** Start URL for every case. */
    url: z.url(),
    /** Seed number shorthand for `testbed.seed`. */
    seed: z.number().int().nonnegative().optional(),
    testbed: QaTestbed.optional(),
    /** Email of the user the harness signs in before each case (testbed control API). */
    login: z.string().optional(),
    budget: QaBudget.default({ steps: 25, seconds: 180, usd: 0.25 }),
    /** Runs per case for pass^k. */
    runs: z.number().int().positive().max(20).default(1),
    allow_origins: z.array(z.string()).default([]),
    /** Secret names the agent may type (values come from the env file or fixtures). */
    secrets: z.array(z.string()).default([]),
    /** Effects every step may take without asking. Default: reversible progress and explicit commits. */
    effects: z.array(z.enum(["advance", "commit"])).default(["advance", "commit"]),
    /** Planted bug flag → title of the case that must catch it. */
    planted_bugs: z.record(z.string(), z.string()).default({}),
  })
  .strict();
export type QaFrontMatter = z.infer<typeof QaFrontMatter>;
export type QaFrontMatterInput = z.input<typeof QaFrontMatter>;

export const QaSpec = z.object({
  path: z.string().optional(),
  frontMatter: QaFrontMatter,
  suites: z.array(QaSuite).min(1),
});
export type QaSpec = z.infer<typeof QaSpec>;

export interface SpecIssue {
  line: number;
  message: string;
}

export type SpecError = { kind: "invalid_spec"; message: string; issues: SpecIssue[] };
