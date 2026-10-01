// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// PKCE (RFC 7636, S256) and random state/nonce values for the ChatGPT sign-in.
import { createHash, randomBytes } from "node:crypto";

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** 32 random bytes as base64url (43 chars): within RFC 7636's 43-128 character verifier range. */
export const randomUrlSafe = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export const s256 = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

export function createPkcePair(): PkcePair {
  const verifier = randomUrlSafe(32);
  return { verifier, challenge: s256(verifier) };
}
