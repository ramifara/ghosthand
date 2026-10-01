// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Variant flags (research note §3.2). Browser-safe: imported by the testbed web app.
import { z } from "zod";

const Testids = z.enum(["on", "off"]);
const A11y = z.enum(["good", "poor"]);

export const Variant = z.object({
  testids: Testids.default("off"),
  a11y: A11y.default("good"),
});
export type Variant = z.infer<typeof Variant>;
export type VariantInput = z.input<typeof Variant>;

/** Partial flags without defaults, for overrides (query string, reset bodies). */
export const VariantOverrides = z.object({ testids: Testids.optional(), a11y: A11y.optional() });
export type VariantOverrides = z.infer<typeof VariantOverrides>;

export const DEFAULT_VARIANT: Variant = { testids: "off", a11y: "good" };
