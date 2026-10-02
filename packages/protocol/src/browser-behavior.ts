// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { z } from "zod";

/** Optional web behavior. Defaults keep automated tests fast and reproducible. */
export const BrowserBehavior = z
  .object({
    reduceAutomationMarkers: z.boolean().default(false),
    nativeWindow: z.boolean().default(false),
    inputPacing: z.enum(["instant", "human"]).default("instant"),
    locale: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          return Intl.getCanonicalLocales(value).length === 1;
        } catch {
          return false;
        }
      }, "expected a locale such as en-US")
      .optional(),
    timezoneId: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return value.length > 0;
        } catch {
          return false;
        }
      }, "expected a timezone such as Europe/Berlin")
      .optional(),
  })
  .strict();
export type BrowserBehavior = z.infer<typeof BrowserBehavior>;
export type BrowserBehaviorInput = z.input<typeof BrowserBehavior>;
