// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L3 per-user settings (tabs, slider, accordion) and the rich-text bio row. Browser-safe.
import { z } from "zod";

export const DIGEST_OPTIONS = ["off", "daily", "weekly"] as const;
export const Digest = z.enum(DIGEST_OPTIONS);
export type Digest = z.infer<typeof Digest>;

export const EMAIL_LIMIT = { min: 0, max: 100, step: 5 } as const;

export const SettingsRow = z.object({
  userId: z.number().int(),
  compactTables: z.boolean(),
  emailLimit: z.number().int(),
  digest: Digest,
  webhookSecretVersion: z.number().int(),
  apiKeyRevoked: z.boolean(),
});
export type SettingsRow = z.infer<typeof SettingsRow>;

/** What every user starts with after a reset. */
export const DEFAULT_SETTINGS: Omit<SettingsRow, "userId"> = {
  compactTables: false,
  emailLimit: 20,
  digest: "weekly",
  webhookSecretVersion: 1,
  apiKeyRevoked: false,
};

export const GeneralSettingsInput = z.object({ compactTables: z.boolean() });
export type GeneralSettingsInput = z.infer<typeof GeneralSettingsInput>;

export const NotificationSettingsInput = z.object({
  emailLimit: z
    .number()
    .int()
    .min(EMAIL_LIMIT.min)
    .max(EMAIL_LIMIT.max)
    .refine((v) => v % EMAIL_LIMIT.step === 0, `Use steps of ${EMAIL_LIMIT.step}.`),
  digest: Digest,
});
export type NotificationSettingsInput = z.infer<typeof NotificationSettingsInput>;

export const BioRow = z.object({ userId: z.number().int(), html: z.string() });
export type BioRow = z.infer<typeof BioRow>;

export const SETTINGS_MESSAGES = {
  general: "General settings saved.",
  notifications: "Notification settings saved.",
  webhookRotated: "Webhook secret rotated.",
  apiKeyRevoked: "API key revoked.",
  bioSaved: "Bio saved.",
} as const;
