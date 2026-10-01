// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Seeded fixture data. Same seed in, same rows out.
import type { Database } from "bun:sqlite";
import { ALICE_EMAIL, BOB_EMAIL, createRng, fixtureSecrets, type Rng } from "@ghosthand/testbed-kit";
import { authSeeds } from "./auth-seeds.ts";
import { hashPassword } from "./password.ts";
import { nameHash, seedShop } from "./shop-seed.ts";

const FIRST = [
  "Chidi",
  "Dana",
  "Eun-ji",
  "Farah",
  "Goran",
  "Hana",
  "Ivo",
  "Jonas",
  "Kemi",
  "Lior",
  "Mira",
  "Nils",
];
const LAST = [
  "Okafor",
  "Petrov",
  "Quinn",
  "Rossi",
  "Sato",
  "Tan",
  "Ueda",
  "Varga",
  "Weber",
  "Xu",
  "Young",
  "Zim",
];
const TITLES = ["Engineer", "Designer", "Product Manager", "QA Analyst", "Support Lead", "Data Scientist"];
const RELEASES = ["Amber Falcon", "Cobalt Heron", "Jade Lynx", "Slate Otter", "Umber Kestrel"];

export interface SeedUser {
  email: string;
  name: string;
  handle: string;
  title: string;
  website: string;
  bio: string;
  password: string;
}

function insertUser(db: Database, rng: Rng, user: SeedUser): void {
  const salt = rng.hex(16);
  db.query(
    `insert into users (email, name, handle, title, website, bio, password_salt, password_hash)
     values ($email, $name, $handle, $title, $website, $bio, $salt, $hash)`,
  ).run({
    email: user.email,
    name: user.name,
    handle: user.handle,
    title: user.title,
    website: user.website,
    bio: user.bio,
    salt,
    hash: hashPassword(salt, user.password),
  });
}

function generatedUser(rng: Rng, taken: Set<string>): SeedUser {
  for (;;) {
    const first = rng.pick(FIRST);
    const last = rng.pick(LAST);
    const handle = `${first}-${last}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (taken.has(handle)) continue;
    taken.add(handle);
    return {
      email: `${handle}@testbed.local`,
      name: `${first} ${last}`,
      handle,
      title: rng.pick(TITLES),
      website: rng.next() < 0.5 ? `https://${handle}.example` : "",
      bio: "",
      password: `pw-${rng.hex(12)}`,
    };
  }
}

/** Fills a fresh database from `seed`. Alice and Bob are fixed; the rest comes from the PRNG. */
export function seedBase(db: Database, seed: number): void {
  const rng = createRng(seed);
  const fixed: SeedUser[] = [
    {
      email: ALICE_EMAIL,
      name: "Alice Archer",
      handle: "alice",
      title: "Engineer",
      website: "https://alice.example",
      bio: "Builds test fixtures.",
      password: fixtureSecrets.TESTBED_PASSWORD,
    },
    {
      email: BOB_EMAIL,
      name: "Bob Ng",
      handle: "bob",
      title: "Designer",
      website: "",
      bio: "",
      password: fixtureSecrets.TESTBED_BOB_PASSWORD,
    },
  ];
  const taken = new Set(fixed.map((u) => u.handle));
  for (const u of fixed) insertUser(db, rng, u);
  for (let i = 0; i < 8; i++) insertUser(db, rng, generatedUser(rng, taken));

  const facts: Record<string, string> = {
    build_code: `GH-${rng.int(1000, 9999)}`,
    release_name: rng.pick(RELEASES),
    open_tickets: String(rng.int(3, 40)),
  };
  for (const [key, value] of Object.entries(facts)) {
    db.query("insert into facts (key, value) values ($key, $value)").run({ key, value });
  }

  const aliceId = db
    .query<{ id: number }, { email: string }>("select id from users where email = $email")
    .get({ email: ALICE_EMAIL })?.id;
  if (aliceId === undefined) throw new Error("seedBase: alice missing");
  seedShop(db, seed, aliceId);
}

export type NamedSeed = (db: Database, ctx: { seed: number; now: string }) => void;

/** Extra fixture sets for `POST /seed/:name`, applied on top of the base seed. */
export const namedSeeds: Record<string, NamedSeed> = {
  "welcome-mail": (db, { now }) => {
    db.query(
      `insert into mail (at, to_addr, from_addr, subject, body)
       values ($at, $to, 'no-reply@testbed.local', 'Welcome to the testbed', $body)`,
    ).run({ at: now, to: ALICE_EMAIL, body: "Your account is ready. Sign in to edit your profile." });
  },
  "extra-users": (db, { seed }) => {
    const rng = createRng((seed ^ nameHash("extra-users")) >>> 0);
    const taken = new Set(
      db
        .query<{ handle: string }, []>("select handle from users")
        .all()
        .map((r) => r.handle),
    );
    for (let i = 0; i < 5; i++) insertUser(db, rng, generatedUser(rng, taken));
  },
  ...authSeeds,
};
