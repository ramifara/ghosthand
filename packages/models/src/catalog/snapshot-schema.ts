// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Shapes of the models.dev API (input, lenient) and of our committed snapshot (output, strict).
// Field names follow models.dev so a snapshot entry can be compared with the upstream TOML by eye.
import { z } from "zod";

const Modalities = z.object({ input: z.array(z.string()), output: z.array(z.string()) });

/** One model in `https://models.dev/api.json`. Unknown fields are stripped. */
export const ModelsDevModel = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string().optional(),
  reasoning: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  structured_output: z.boolean().optional(),
  release_date: z.string().optional(),
  status: z.string().optional(),
  modalities: Modalities.optional(),
  limit: z.object({ context: z.number(), output: z.number() }).partial().optional(),
  cost: z
    .object({
      input: z.number(),
      output: z.number(),
      cache_read: z.number(),
      cache_write: z.number(),
    })
    .partial()
    .optional(),
});
export type ModelsDevModel = z.infer<typeof ModelsDevModel>;

export const ModelsDevProvider = z.object({
  id: z.string(),
  name: z.string(),
  env: z.array(z.string()).default([]),
  npm: z.string().optional(),
  api: z.string().optional(),
  doc: z.string().optional(),
  models: z.record(z.string(), z.unknown()),
});
export type ModelsDevProvider = z.infer<typeof ModelsDevProvider>;

/** `https://models.dev/api.json`: provider id → provider. */
export const ModelsDevApi = z.record(z.string(), z.unknown());

export const SnapshotModel = z.object({
  name: z.string(),
  family: z.string().optional(),
  modalities: Modalities,
  limit: z.object({ context: z.number().int().nonnegative(), output: z.number().int().nonnegative() }),
  /** USD per million tokens. */
  cost: z
    .object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cache_read: z.number().nonnegative().optional(),
      cache_write: z.number().nonnegative().optional(),
    })
    .optional(),
  tool_call: z.boolean(),
  /** Absent when models.dev does not say. */
  structured_output: z.boolean().optional(),
  reasoning: z.boolean(),
  release_date: z.string().optional(),
  status: z.enum(["alpha", "beta"]).optional(),
});
export type SnapshotModel = z.infer<typeof SnapshotModel>;

export const SnapshotProvider = z.object({
  name: z.string(),
  env: z.array(z.string()),
  npm: z.string().optional(),
  api: z.string().optional(),
  doc: z.string().optional(),
  models: z.record(z.string(), SnapshotModel),
});
export type SnapshotProvider = z.infer<typeof SnapshotProvider>;

export const ModelsSnapshot = z.object({
  schemaVersion: z.literal(1),
  /** Where the data came from: a models.dev checkout (with commit) or the API URL. */
  source: z.string(),
  generatedAt: z.string(),
  /** models.dev data is MIT-licensed; keep the attribution with the data. */
  attribution: z.string(),
  providers: z.record(z.string(), SnapshotProvider),
});
export type ModelsSnapshot = z.infer<typeof ModelsSnapshot>;
