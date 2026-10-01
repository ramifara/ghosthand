// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Profile names are lowercase kebab-case so they are safe directory names on every platform.

import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { ProfileError } from "./profile-error.ts";
import { profileError } from "./profile-error.ts";

export const PROFILE_NAME_MAX_LENGTH = 64;
const PROFILE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Accepts `work`, `acme-staging`, `user2`; rejects empty, uppercase, spaces, dots, slashes and edge dashes. */
export function validateProfileName(name: string): Result<string, ProfileError> {
  if (name.length === 0 || name.length > PROFILE_NAME_MAX_LENGTH || !PROFILE_NAME_RE.test(name)) {
    return err(
      profileError(
        "invalid_name",
        `Invalid profile name "${name}": use 1-${PROFILE_NAME_MAX_LENGTH} lowercase letters, digits and single dashes (e.g. "work" or "acme-staging").`,
      ),
    );
  }
  return ok(name);
}
