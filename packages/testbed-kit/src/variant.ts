// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Variant flags (research note §3.2). Browser-safe: imported by the testbed web app.
import { z } from "zod";

const Testids = z.enum(["on", "off"]);
const A11y = z.enum(["good", "poor"]);
/**
 * Planted bugs for QA mode (Phase 5). Absent means none. Each one breaks a flow silently so a spec has to
 * catch it: `profile-title` makes saving the profile drop the job title while still saying "Profile saved."
 */
export const PlantedBug = z.enum(["profile-title"]);
export type PlantedBug = z.infer<typeof PlantedBug>;

export const Variant = z.object({
  testids: Testids.default("off"),
  a11y: A11y.default("good"),
  bug: PlantedBug.optional(),
});
export type Variant = z.infer<typeof Variant>;
export type VariantInput = z.input<typeof Variant>;

/** Partial flags without defaults, for overrides (query string, reset bodies). */
export const VariantOverrides = z.object({
  testids: Testids.optional(),
  a11y: A11y.optional(),
  bug: PlantedBug.optional(),
});
export type VariantOverrides = z.infer<typeof VariantOverrides>;

export const DEFAULT_VARIANT: Variant = { testids: "off", a11y: "good" };
