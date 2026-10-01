// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// In-memory SQLite schema. Every reset opens a fresh database.
import { Database } from "bun:sqlite";
import { AUTH_SCHEMA, AUTH_TABLES } from "./auth-db.ts";
import { LAB_SCHEMA, LAB_TABLES } from "./lab-db.ts";

const SCHEMA = `
create table users (
  id integer primary key,
  email text not null unique,
  name text not null,
  handle text not null unique,
  title text not null,
  website text not null,
  bio text not null,
  password_salt text not null,
  password_hash text not null
);
create table sessions (
  token text primary key,
  user_id integer not null references users(id),
  created_at text not null
);
create table audit_log (
  id integer primary key autoincrement,
  at text not null,
  actor text not null,
  method text not null,
  path text not null,
  action text not null,
  outcome text not null check (outcome in ('ok', 'rejected', 'error')),
  detail text not null
);
create table mail (
  id integer primary key autoincrement,
  at text not null,
  to_addr text not null,
  from_addr text not null,
  subject text not null,
  body text not null
);
create table facts (
  key text primary key,
  value text not null
);
create table customers (
  id integer primary key,
  name text not null unique,
  email text not null unique
);
create table orders (
  id text primary key,
  customer_id integer not null references customers(id),
  placed_on text not null,
  amount_cents integer not null,
  status text not null check (status in ('pending', 'paid', 'shipped', 'cancelled')),
  note text not null default '',
  tags text not null default '[]',
  deleted_at text
);
create table user_settings (
  user_id integer primary key references users(id),
  compact_tables integer not null,
  email_limit integer not null,
  digest text not null check (digest in ('off', 'daily', 'weekly')),
  webhook_secret_version integer not null,
  api_key_revoked integer not null
);
create table bios (
  user_id integer primary key references users(id),
  html text not null
);
create table cart_items (
  user_id integer not null references users(id),
  product_id text not null,
  quantity integer not null check (quantity > 0),
  primary key (user_id, product_id)
);
create table pickup_stores (
  user_id integer primary key references users(id),
  store text not null
);
`;

export const TABLES = [
  "users",
  "sessions",
  "audit_log",
  "mail",
  "facts",
  "customers",
  "orders",
  "user_settings",
  "bios",
  "cart_items",
  "pickup_stores",
  ...LAB_TABLES,
  ...AUTH_TABLES,
] as const;

export function openDatabase(): Database {
  const db = new Database(":memory:", { strict: true });
  db.exec(SCHEMA);
  db.exec(LAB_SCHEMA);
  db.exec(AUTH_SCHEMA);
  return db;
}
