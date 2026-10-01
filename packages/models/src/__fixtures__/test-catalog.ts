// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A small, stable catalog for tests, independent of the committed models.dev snapshot.
import type { GhostHandFields } from "../catalog/ghosthand-fields.ts";
import type { ModelCatalog } from "../catalog/model-catalog.ts";
import { createModelCatalog } from "../catalog/model-catalog.ts";
import type { ModelsSnapshot } from "../catalog/snapshot-schema.ts";

const vision = { input: ["text", "image"], output: ["text"] };

export const testSnapshot: ModelsSnapshot = {
  schemaVersion: 1,
  source: "test",
  generatedAt: "2026-10-01T00:00:00.000Z",
  attribution: "test",
  providers: {
    openai: {
      name: "OpenAI",
      env: ["OPENAI_API_KEY"],
      npm: "@ai-sdk/openai",
      models: {
        "fast-json": {
          name: "Fast JSON",
          modalities: vision,
          limit: { context: 400_000, output: 32_000 },
          cost: { input: 0.1, output: 0.5, cache_read: 0.01 },
          tool_call: true,
          structured_output: true,
          reasoning: true,
          release_date: "2026-09-22",
        },
        "big-json": {
          name: "Big JSON",
          modalities: vision,
          limit: { context: 1_000_000, output: 128_000 },
          cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
          tool_call: true,
          structured_output: true,
          reasoning: true,
          release_date: "2026-09-29",
        },
        "text-only": {
          name: "Text Only",
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 128_000, output: 16_000 },
          cost: { input: 1, output: 2 },
          tool_call: true,
          reasoning: false,
          release_date: "2025-01-01",
        },
        "small-ctx": {
          name: "Small Context",
          modalities: vision,
          limit: { context: 8_000, output: 4_000 },
          tool_call: true,
          structured_output: true,
          reasoning: false,
        },
      },
    },
    anthropic: {
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      models: {
        "claude-x": {
          name: "Claude X",
          modalities: vision,
          limit: { context: 1_000_000, output: 64_000 },
          cost: { input: 3, output: 15 },
          tool_call: true,
          structured_output: true,
          reasoning: true,
        },
      },
    },
  },
};

export const testBuiltin: Readonly<Record<string, GhostHandFields>> = {
  "openai/big-json": { computerUse: "openai_computer", grounding: "pixels" },
};

export function testCatalog(overrides?: unknown): ModelCatalog {
  const created = createModelCatalog({ snapshot: testSnapshot, builtin: testBuiltin, overrides });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}
