// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Testbed state: the current database, clock, seed and variant, plus the queries both APIs share.
import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import {
  type AuditOutcome,
  type AuditRow,
  type BioRow,
  type CartItemRow,
  type CustomerRow,
  DEFAULT_NOW,
  DEFAULT_SEED,
  DEFAULT_VARIANT,
  type MailRow,
  ORDER_TAGS,
  type OrderRow,
  type OrderStatus,
  type OrderTag,
  type PickupStoreRow,
  type ResetRequest,
  type SessionRow,
  type SettingsRow,
  type TestbedState,
  type UserRow,
  Variant,
} from "@ghosthand/testbed-kit";
import { type Clock, createFrozenClock } from "./clock.ts";
import { openDatabase, TABLES } from "./db.ts";
import { namedSeeds, seedBase } from "./seed-data.ts";
import { ensureSettings } from "./shop-seed.ts";

export interface AuditEntry {
  actor: string;
  method: string;
  path: string;
  action: string;
  outcome: AuditOutcome;
  detail: Record<string, unknown>;
}

export interface UserWithSecret extends UserRow {
  passwordSalt: string;
  passwordHash: string;
}

const USER_COLUMNS =
  "id, email, name, handle, title, website, bio, password_salt as passwordSalt, password_hash as passwordHash";

const ORDER_COLUMNS = `o.id, o.customer_id as customerId, c.name as customerName, o.placed_on as placedOn,
  o.amount_cents as amountCents, o.status, o.note, o.tags, o.deleted_at as deletedAt`;

type OrderDbRow = Omit<OrderRow, "tags" | "status"> & { status: string; tags: string };

/** Tags are stored as JSON and always returned in ORDER_TAGS order, so equal sets compare equal. */
export function sortTags(tags: readonly OrderTag[]): OrderTag[] {
  return ORDER_TAGS.filter((t) => tags.includes(t));
}

function toOrder(row: OrderDbRow): OrderRow {
  const tags = JSON.parse(row.tags) as OrderTag[];
  return { ...row, status: row.status as OrderStatus, tags: sortTags(tags) };
}

const SETTINGS_COLUMNS = `user_id as userId, compact_tables as compactTables, email_limit as emailLimit, digest,
  webhook_secret_version as webhookSecretVersion, api_key_revoked as apiKeyRevoked`;

type SettingsDbRow = Omit<SettingsRow, "compactTables" | "apiKeyRevoked" | "digest"> & {
  compactTables: number;
  apiKeyRevoked: number;
  digest: string;
};

function toSettings(row: SettingsDbRow): SettingsRow {
  return {
    ...row,
    compactTables: row.compactTables === 1,
    apiKeyRevoked: row.apiKeyRevoked === 1,
    digest: row.digest as SettingsRow["digest"],
  };
}

export class Testbed {
  db: Database;
  readonly clock: Clock;
  seed = DEFAULT_SEED;
  variant: Variant = DEFAULT_VARIANT;
  resetId = 0;
  private initialUsers: UserRow[] = [];
  private initialOrders: OrderRow[] = [];
  private initialSettings: SettingsRow[] = [];
  private initialBios: BioRow[] = [];

  constructor(clock: Clock = createFrozenClock(DEFAULT_NOW)) {
    this.clock = clock;
    this.db = openDatabase();
    this.reset({});
  }

  /** Drops the database and rebuilds it from `seed`. Also resets the clock and clears mail. */
  reset(request: ResetRequest): void {
    this.db.close();
    this.db = openDatabase();
    this.seed = request.seed ?? DEFAULT_SEED;
    this.variant = Variant.parse({ ...DEFAULT_VARIANT, ...request.variant });
    this.clock.set(DEFAULT_NOW);
    this.resetId += 1;
    seedBase(this.db, this.seed);
    this.captureInitial();
  }

  private captureInitial(): void {
    this.initialUsers = this.users();
    this.initialOrders = this.orders();
    this.initialSettings = this.settings();
    this.initialBios = this.bios();
  }

  applySeed(name: string): boolean {
    const seedFn = namedSeeds[name];
    if (!seedFn) return false;
    seedFn(this.db, { seed: this.seed, now: this.clock.now() });
    ensureSettings(this.db);
    // Named seeds are part of setup, so they count as the starting state for oracles.
    this.captureInitial();
    return true;
  }

  users(): UserRow[] {
    return this.db
      .query<UserRow, []>("select id, email, name, handle, title, website, bio from users order by id")
      .all();
  }

  userByEmail(email: string): UserWithSecret | undefined {
    return (
      this.db
        .query<UserWithSecret, { email: string }>(`select ${USER_COLUMNS} from users where email = $email`)
        .get({ email: email.trim().toLowerCase() }) ?? undefined
    );
  }

  userBySession(token: string): UserRow | undefined {
    return (
      this.db
        .query<UserRow, { token: string }>(
          `select u.id, u.email, u.name, u.handle, u.title, u.website, u.bio
           from sessions s join users u on u.id = s.user_id where s.token = $token`,
        )
        .get({ token }) ?? undefined
    );
  }

  createSession(userId: number): string {
    const token = randomBytes(24).toString("base64url");
    this.db
      .query("insert into sessions (token, user_id, created_at) values ($token, $userId, $at)")
      .run({ token, userId, at: this.clock.now() });
    return token;
  }

  deleteSession(token: string): void {
    this.db.query("delete from sessions where token = $token").run({ token });
  }

  audit(entry: AuditEntry): void {
    this.db
      .query(
        `insert into audit_log (at, actor, method, path, action, outcome, detail)
         values ($at, $actor, $method, $path, $action, $outcome, $detail)`,
      )
      .run({ ...entry, at: this.clock.now(), detail: JSON.stringify(entry.detail) });
  }

  sendMail(to: string, subject: string, body: string): void {
    this.db
      .query(
        `insert into mail (at, to_addr, from_addr, subject, body)
         values ($at, $to, 'no-reply@testbed.local', $subject, $body)`,
      )
      .run({ at: this.clock.now(), to, subject, body });
  }

  mail(to?: string): MailRow[] {
    const columns = `id, at, to_addr as "to", from_addr as "from", subject, body`;
    if (to === undefined) return this.db.query<MailRow, []>(`select ${columns} from mail order by id`).all();
    return this.db
      .query<MailRow, { to: string }>(`select ${columns} from mail where to_addr = $to order by id`)
      .all({ to });
  }

  facts(): Record<string, string> {
    const rows = this.db.query<{ key: string; value: string }, []>("select key, value from facts").all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** The read-only snapshot oracles run against. */
  snapshot(): TestbedState {
    const audit = this.db
      .query<Omit<AuditRow, "detail"> & { detail: string }, []>(
        "select id, at, actor, method, path, action, outcome, detail from audit_log order by id",
      )
      .all()
      .map((row) => ({ ...row, detail: JSON.parse(row.detail) as Record<string, unknown> }));
    const sessions = this.db
      .query<SessionRow, []>("select user_id as userId, created_at as createdAt from sessions order by rowid")
      .all();
    return {
      seed: this.seed,
      variant: this.variant,
      now: this.clock.now(),
      users: this.users(),
      initialUsers: this.initialUsers,
      sessions,
      audit,
      mail: this.mail(),
      customers: this.customers(),
      orders: this.orders(),
      initialOrders: this.initialOrders,
      settings: this.settings(),
      initialSettings: this.initialSettings,
      bios: this.bios(),
      initialBios: this.initialBios,
      cart: this.cart(),
      pickupStores: this.pickupStores(),
    };
  }

  cart(userId?: number): CartItemRow[] {
    const sql = `select user_id as userId, product_id as productId, quantity from cart_items`;
    if (userId === undefined)
      return this.db.query<CartItemRow, []>(`${sql} order by user_id, product_id`).all();
    return this.db
      .query<CartItemRow, { userId: number }>(`${sql} where user_id = $userId order by product_id`)
      .all({ userId });
  }

  pickupStores(): PickupStoreRow[] {
    return this.db
      .query<PickupStoreRow, []>("select user_id as userId, store from pickup_stores order by user_id")
      .all();
  }

  customers(): CustomerRow[] {
    return this.db.query<CustomerRow, []>("select id, name, email from customers order by id").all();
  }

  /** Every order, including soft-deleted ones, in id order. */
  orders(): OrderRow[] {
    return this.db
      .query<OrderDbRow, []>(
        `select ${ORDER_COLUMNS} from orders o join customers c on c.id = o.customer_id order by o.id`,
      )
      .all()
      .map(toOrder);
  }

  order(id: string): OrderRow | undefined {
    const row = this.db
      .query<OrderDbRow, { id: string }>(
        `select ${ORDER_COLUMNS} from orders o join customers c on c.id = o.customer_id where o.id = $id`,
      )
      .get({ id });
    return row ? toOrder(row) : undefined;
  }

  settings(): SettingsRow[] {
    return this.db
      .query<SettingsDbRow, []>(`select ${SETTINGS_COLUMNS} from user_settings order by user_id`)
      .all()
      .map(toSettings);
  }

  settingsFor(userId: number): SettingsRow | undefined {
    const row = this.db
      .query<SettingsDbRow, { userId: number }>(
        `select ${SETTINGS_COLUMNS} from user_settings where user_id = $userId`,
      )
      .get({ userId });
    return row ? toSettings(row) : undefined;
  }

  bios(): BioRow[] {
    return this.db.query<BioRow, []>("select user_id as userId, html from bios order by user_id").all();
  }

  /** Every row of every table, for determinism checks and debugging. */
  dump(): Record<string, unknown[]> {
    return Object.fromEntries(
      TABLES.map((t) => [
        t,
        this.db.query<Record<string, unknown>, []>(`select * from ${t} order by rowid`).all(),
      ]),
    );
  }
}
