// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Fixture credentials for the testbed. Test values only, never real secrets.
// scripts/secrets-check.ts parses the `NAME: "value"` pairs below and fails if any value
// appears in a run folder or log, so keep one string literal per line in exactly this form.

export const fixtureSecrets = {
  TESTBED_PASSWORD: "violet-harbor-42",
  TESTBED_WRONG_PASSWORD: "violet-harbour-24",
  TESTBED_BOB_PASSWORD: "copper-meadow-17",
} as const;

export type FixtureSecretName = keyof typeof fixtureSecrets;

export function isFixtureSecretName(name: string): name is FixtureSecretName {
  return Object.hasOwn(fixtureSecrets, name);
}
