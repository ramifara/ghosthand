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

/**
 * L6 robustness flags. Each is optional and absent means today's behavior, so released L1-L3 tasks are
 * unaffected:
 * - `latency: "slow"`: seeded 300-2500 ms server latency on the contact-preferences API.
 * - `flaky: "on"`: the first contact-preferences load fails with a 503; the page offers Retry.
 * - `popups: "on"`: a cookie banner and a seeded promo modal that blocks the page.
 * - `layoutShift: "on"`: a notice is inserted above the preferences save button after a delay.
 * - `ids: "dynamic"`: preference fields get random ids and class names on every render.
 * - `locale: "ar"`: the preferences page in Arabic, with `dir="rtl"` on the document.
 * - `theme`: forces light or dark instead of the device theme.
 * - `zoom: "150"`: root font size at 150%.
 * `a11y: "poor"` only changes the L6 preferences page (unlabeled inputs, div buttons, unnamed icon buttons).
 */
const robustness = {
  latency: z.enum(["none", "slow"]).optional(),
  flaky: z.enum(["off", "on"]).optional(),
  popups: z.enum(["off", "on"]).optional(),
  layoutShift: z.enum(["off", "on"]).optional(),
  ids: z.enum(["stable", "dynamic"]).optional(),
  locale: z.enum(["en", "ar"]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  zoom: z.enum(["100", "150"]).optional(),
};

/** Names of the optional L6 flags, in a fixed order. */
export const ROBUSTNESS_FLAGS = Object.keys(robustness) as (keyof typeof robustness)[];
export type RobustnessFlag = (typeof ROBUSTNESS_FLAGS)[number];

export const Variant = z.object({
  testids: Testids.default("off"),
  a11y: A11y.default("good"),
  bug: PlantedBug.optional(),
  ...robustness,
});
export type Variant = z.infer<typeof Variant>;
export type VariantInput = z.input<typeof Variant>;

/** Partial flags without defaults, for overrides (query string, reset bodies). */
export const VariantOverrides = z.object({
  testids: Testids.optional(),
  a11y: A11y.optional(),
  bug: PlantedBug.optional(),
  ...robustness,
});
export type VariantOverrides = z.infer<typeof VariantOverrides>;

export const DEFAULT_VARIANT: Variant = { testids: "off", a11y: "good" };
