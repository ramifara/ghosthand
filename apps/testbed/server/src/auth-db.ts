// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Tables for L5 (out-of-band auth, the fake IdP, status messages) and L6 (contact preferences).
import type { Database } from "bun:sqlite";
import type { ContactPrefsRow, StatusRow } from "@ghosthand/testbed-kit";

export const AUTH_SCHEMA = `
create table auth_tokens (
  token text primary key,
  kind text not null check (kind in ('mfa', 'magic_link', 'email_code', 'password_reset', 'sso_state', 'idp_request', 'idp_code')),
  user_id integer references users(id),
  code text,
  data text not null default '{}',
  attempts integer not null default 0,
  created_at text not null,
  used_at text
);
create table user_totp (
  user_id integer primary key references users(id),
  secret text not null
);
create table user_status (
  user_id integer primary key references users(id),
  message text not null
);
create table contact_prefs (
  user_id integer primary key references users(id),
  phone text not null,
  method text not null check (method in ('email', 'phone', 'sms')),
  news integer not null,
  unsubscribed integer not null
);
`;

export const AUTH_TABLES = ["auth_tokens", "user_totp", "user_status", "contact_prefs"] as const;

export function statuses(db: Database): StatusRow[] {
  return db.query<StatusRow, []>("select user_id as userId, message from user_status order by user_id").all();
}

type PrefsDbRow = Omit<ContactPrefsRow, "news" | "unsubscribed" | "method"> & {
  method: string;
  news: number;
  unsubscribed: number;
};

const PREFS_COLUMNS = "user_id as userId, phone, method, news, unsubscribed";

function toPrefs(row: PrefsDbRow): ContactPrefsRow {
  return {
    ...row,
    method: row.method as ContactPrefsRow["method"],
    news: row.news === 1,
    unsubscribed: row.unsubscribed === 1,
  };
}

export function contactPrefs(db: Database): ContactPrefsRow[] {
  return db
    .query<PrefsDbRow, []>(`select ${PREFS_COLUMNS} from contact_prefs order by user_id`)
    .all()
    .map(toPrefs);
}

export function contactPrefsOf(db: Database, userId: number): ContactPrefsRow | undefined {
  const row = db
    .query<PrefsDbRow, { userId: number }>(
      `select ${PREFS_COLUMNS} from contact_prefs where user_id = $userId`,
    )
    .get({ userId });
  return row ? toPrefs(row) : undefined;
}

export function saveContactPrefs(db: Database, row: ContactPrefsRow): void {
  db.query(
    `insert into contact_prefs (user_id, phone, method, news, unsubscribed)
     values ($userId, $phone, $method, $news, $unsubscribed)
     on conflict(user_id) do update set phone = excluded.phone, method = excluded.method,
       news = excluded.news, unsubscribed = excluded.unsubscribed`,
  ).run({ ...row, news: row.news ? 1 : 0, unsubscribed: row.unsubscribed ? 1 : 0 });
}
