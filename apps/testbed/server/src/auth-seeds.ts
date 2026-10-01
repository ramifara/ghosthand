// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Named seeds for L5 tasks, merged into `namedSeeds`. None of them touch the PRNG, so base seeds stay put.
import type { Database } from "bun:sqlite";
import { ALICE_EMAIL, AUTH_SEEDS, fixtureSecrets } from "@ghosthand/testbed-kit";
import { setFact } from "./auth-tokens.ts";

/** Facts key of the session-expiry trap: "armed" until it fires once, then "fired". */
export const SESSION_EXPIRY_FACT = "session_expiry";

function aliceId(db: Database): number {
  const id = db
    .query<{ id: number }, { email: string }>("select id from users where email = $email")
    .get({ email: ALICE_EMAIL })?.id;
  if (id === undefined) throw new Error("auth seeds: alice missing");
  return id;
}

export const authSeeds: Record<string, (db: Database, ctx: { seed: number; now: string }) => void> = {
  [AUTH_SEEDS.aliceTotp]: (db) => {
    db.query(
      "insert into user_totp (user_id, secret) values ($id, $secret) on conflict(user_id) do nothing",
    ).run({ id: aliceId(db), secret: fixtureSecrets.TESTBED_TOTP });
  },
  [AUTH_SEEDS.sessionExpiry]: (db) => {
    setFact(db, SESSION_EXPIRY_FACT, "armed");
  },
};
