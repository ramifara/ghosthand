// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Deterministic salted hashes, so a reset with the same seed yields byte-identical rows.
// Fine for a local fixture app; never use this for real credentials.
import { createHash, timingSafeEqual } from "node:crypto";

export function hashPassword(salt: string, password: string): string {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

export function verifyPassword(salt: string, hash: string, password: string): boolean {
  const a = Buffer.from(hashPassword(salt, password), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
