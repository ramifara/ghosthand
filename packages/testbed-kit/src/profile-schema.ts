// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Profile form rules shared by client and server validation. Browser-safe.
// Server-only rules (handle uniqueness) live in the testbed server.
import { z } from "zod";

export const PROFILE_LIMITS = { nameMax: 60, titleMax: 60, bioMax: 160 } as const;

export const ProfileInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(PROFILE_LIMITS.nameMax, `Display name must be at most ${PROFILE_LIMITS.nameMax} characters.`),
  handle: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{3,20}$/, "Handle must be 3 to 20 characters: lowercase letters, digits or hyphens."),
  title: z
    .string()
    .trim()
    .max(PROFILE_LIMITS.titleMax, `Job title must be at most ${PROFILE_LIMITS.titleMax} characters.`),
  website: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https:\/\/[^\s/]+\.[^\s]+$/.test(v), "Website must be a full https:// URL."),
  bio: z.string().max(PROFILE_LIMITS.bioMax, `Bio must be at most ${PROFILE_LIMITS.bioMax} characters.`),
});
export type ProfileInput = z.infer<typeof ProfileInput>;
export type ProfileField = keyof ProfileInput;
export type FieldErrors = Partial<Record<ProfileField, string>>;

const fields = new Set<string>(Object.keys(ProfileInput.shape));

/** Validates a profile and returns either the cleaned value or one message per invalid field. */
export function validateProfile(
  input: unknown,
): { ok: true; value: ProfileInput } | { ok: false; fieldErrors: FieldErrors } {
  const parsed = ProfileInput.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && fields.has(field)) {
      const key = field as ProfileField;
      fieldErrors[key] ??= issue.message;
    }
  }
  return { ok: false, fieldErrors };
}
