// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 lab tables: schema, seed and the read-back the oracle snapshot uses. Same seed in, same rows out.
import type { Database } from "bun:sqlite";
import {
  BOARD_CARDS,
  type BoardColumn,
  CHECKLIST_ITEMS,
  type ContactRow,
  type DigestTime,
  LAB_PROJECTS,
  type LabState,
  labFeedEvents,
  labSkus,
  SEED_CONTACTS,
  type ShippingRow,
  type Workspace,
} from "@ghosthand/testbed-kit";

export const LAB_SCHEMA = `
create table lab_shipping (
  user_id integer primary key references users(id),
  full_name text not null,
  street text not null,
  city text not null,
  postal_code text not null,
  country text not null
);
create table lab_gift_notes (
  user_id integer primary key references users(id),
  message text not null
);
create table lab_prefs (
  user_id integer primary key references users(id),
  digest_at text not null,
  weekly_summary integer not null
);
create table lab_promos (
  id integer primary key autoincrement,
  user_id integer not null references users(id),
  code text not null
);
create table lab_checklist (
  id text primary key,
  title text not null,
  position integer not null
);
create table lab_cards (
  id text primary key,
  title text not null,
  column_id text not null check (column_id in ('todo', 'doing', 'done')),
  position integer not null
);
create table lab_contacts (
  id integer primary key autoincrement,
  name text not null,
  email text not null unique,
  company text not null,
  source text not null check (source in ('seed', 'import'))
);
create table lab_events (
  id text primary key,
  title text not null,
  at text not null,
  flagged integer not null default 0
);
create table lab_skus (
  id text primary key,
  name text not null,
  stock integer not null,
  discontinued integer not null default 0
);
create table lab_projects (
  id text primary key,
  name text not null,
  workspace text not null,
  archived integer not null default 0
);
create table lab_workspaces (
  user_id integer primary key references users(id),
  workspace text not null
);
`;

export const LAB_TABLES = [
  "lab_shipping",
  "lab_gift_notes",
  "lab_prefs",
  "lab_promos",
  "lab_checklist",
  "lab_cards",
  "lab_contacts",
  "lab_events",
  "lab_skus",
  "lab_projects",
  "lab_workspaces",
] as const;

/** Seeds the lab tables. Runs after the users exist; per-user rows (prefs, workspace) appear on first save. */
export function seedLab(db: Database, seed: number): void {
  db.transaction(() => {
    CHECKLIST_ITEMS.forEach((item, position) => {
      db.query("insert into lab_checklist (id, title, position) values ($id, $title, $position)").run({
        ...item,
        position,
      });
    });
    const perColumn = new Map<BoardColumn, number>();
    for (const card of BOARD_CARDS) {
      const position = perColumn.get(card.column) ?? 0;
      perColumn.set(card.column, position + 1);
      db.query(
        "insert into lab_cards (id, title, column_id, position) values ($id, $title, $column, $position)",
      ).run({ ...card, position });
    }
    for (const c of SEED_CONTACTS) {
      db.query(
        "insert into lab_contacts (name, email, company, source) values ($name, $email, $company, 'seed')",
      ).run(c);
    }
    for (const e of labFeedEvents(seed)) {
      db.query("insert into lab_events (id, title, at) values ($id, $title, $at)").run(e);
    }
    for (const s of labSkus(seed)) {
      db.query("insert into lab_skus (id, name, stock) values ($id, $name, $stock)").run(s);
    }
    for (const p of LAB_PROJECTS) {
      db.query("insert into lab_projects (id, name, workspace) values ($id, $name, $workspace)").run(p);
    }
  })();
}

export function readContacts(db: Database): ContactRow[] {
  return db
    .query<ContactRow, []>("select id, name, email, company, source from lab_contacts order by id")
    .all();
}

/** The lab part of the oracle snapshot. */
export function readLab(db: Database): LabState {
  const ids = (sql: string): string[] =>
    db
      .query<{ id: string }, []>(sql)
      .all()
      .map((r) => r.id);
  return {
    shipping: db
      .query<ShippingRow, []>(
        `select user_id as userId, full_name as fullName, street, city, postal_code as postalCode, country
         from lab_shipping order by user_id`,
      )
      .all(),
    giftNotes: db
      .query<{ userId: number; message: string }, []>(
        "select user_id as userId, message from lab_gift_notes order by user_id",
      )
      .all(),
    prefs: db
      .query<{ userId: number; digestAt: DigestTime; weeklySummary: number }, []>(
        "select user_id as userId, digest_at as digestAt, weekly_summary as weeklySummary from lab_prefs order by user_id",
      )
      .all()
      .map((r) => ({ ...r, weeklySummary: r.weeklySummary === 1 })),
    promos: db
      .query<{ userId: number; code: string }, []>(
        "select user_id as userId, code from lab_promos order by id",
      )
      .all(),
    checklist: db
      .query<{ id: string; title: string; position: number }, []>(
        "select id, title, position from lab_checklist order by position",
      )
      .all(),
    cards: db
      .query<{ id: string; title: string; column: BoardColumn; position: number }, []>(
        "select id, title, column_id as column, position from lab_cards order by column_id, position",
      )
      .all(),
    contacts: readContacts(db),
    flaggedEvents: ids("select id from lab_events where flagged = 1 order by id"),
    discontinuedSkus: ids("select id from lab_skus where discontinued = 1 order by id"),
    projects: db
      .query<{ id: string; name: string; workspace: Workspace; archived: number }, []>(
        "select id, name, workspace, archived from lab_projects order by id",
      )
      .all()
      .map((r) => ({ ...r, archived: r.archived === 1 })),
    workspaces: db
      .query<{ userId: number; workspace: Workspace }, []>(
        "select user_id as userId, workspace from lab_workspaces order by user_id",
      )
      .all(),
  };
}
