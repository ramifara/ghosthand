// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Single-use tokens for L5 flows (two-step challenges, magic links, email codes, resets, SSO) and the
// key/value facts the L5/L6 routes keep per reset. Tokens are random; the clock only stamps them.
import type { Database } from "bun:sqlite";
import { randomBytes, randomInt } from "node:crypto";

export type TokenKind =
  | "mfa"
  | "magic_link"
  | "email_code"
  | "password_reset"
  | "sso_state"
  | "idp_request"
  | "idp_code";

export interface TokenRow {
  token: string;
  kind: TokenKind;
  userId: number | null;
  code: string | null;
  data: Record<string, string>;
  attempts: number;
  createdAt: string;
  usedAt: string | null;
}

/** Wrong guesses allowed on a code before the challenge is void. */
export const MAX_ATTEMPTS = 5;

export function createToken(
  db: Database,
  input: { kind: TokenKind; now: string; userId?: number; code?: string; data?: Record<string, string> },
): string {
  const token = randomBytes(24).toString("base64url");
  db.query(
    `insert into auth_tokens (token, kind, user_id, code, data, created_at)
     values ($token, $kind, $userId, $code, $data, $now)`,
  ).run({
    token,
    kind: input.kind,
    userId: input.userId ?? null,
    code: input.code ?? null,
    data: JSON.stringify(input.data ?? {}),
    now: input.now,
  });
  return token;
}

/** An unused token of `kind`, or undefined. */
export function liveToken(db: Database, token: string | undefined, kind: TokenKind): TokenRow | undefined {
  if (!token) return undefined;
  const row = db
    .query<Omit<TokenRow, "data"> & { data: string }, { token: string; kind: string }>(
      `select token, kind, user_id as userId, code, data, attempts, created_at as createdAt, used_at as usedAt
       from auth_tokens where token = $token and kind = $kind and used_at is null`,
    )
    .get({ token, kind });
  if (!row || row.attempts >= MAX_ATTEMPTS) return undefined;
  return { ...row, data: JSON.parse(row.data) as Record<string, string> };
}

export function useToken(db: Database, token: string, now: string): void {
  db.query("update auth_tokens set used_at = $now where token = $token").run({ token, now });
}

export function countAttempt(db: Database, token: string): void {
  db.query("update auth_tokens set attempts = attempts + 1 where token = $token").run({ token });
}

export function setTokenUser(db: Database, token: string, userId: number): void {
  db.query("update auth_tokens set user_id = $userId where token = $token").run({ token, userId });
}

export function sixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function fact(db: Database, key: string): string | undefined {
  return (
    db.query<{ value: string }, { key: string }>("select value from facts where key = $key").get({ key })
      ?.value ?? undefined
  );
}

export function setFact(db: Database, key: string, value: string): void {
  db.query(
    "insert into facts (key, value) values ($key, $value) on conflict(key) do update set value = excluded.value",
  ).run({ key, value });
}
