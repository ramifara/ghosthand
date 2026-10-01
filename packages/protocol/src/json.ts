// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { z } from "zod";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const JsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(z.string(), JsonValue),
  ]),
);

/** Text, a JSON object or array, or null. The shape Jev accepts for state, instructions and criteria. */
export const Entry = z.union([z.string(), z.record(z.string(), JsonValue), z.array(JsonValue), z.null()]);
export type Entry = z.infer<typeof Entry>;
