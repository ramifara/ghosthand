// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L2/L3 fixture data: customers, orders, per-user settings and bios. Same seed in, same rows out.
import type { Database } from "bun:sqlite";
import {
  CUSTOMER_NAMES,
  type CustomerName,
  createRng,
  customerEmail,
  DEFAULT_SETTINGS,
  FIRST_ORDER_DATE,
  FIRST_ORDER_NUMBER,
  ORDER_ANCHORS,
  ORDER_COUNT,
  ORDER_DATE_SPAN,
  ORDER_TAGS,
  type OrderAnchor,
  type OrderStatus,
  type OrderTag,
  PENDING_ORDER_COUNT,
} from "@ghosthand/testbed-kit";

/** Alice's public bio before any task touches it. */
export const ALICE_BIO_HTML =
  "<p>I build test fixtures for the GhostHand testbed.</p><p>Ask me about <em>flaky</em> selectors.</p>";

export function nameHash(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface SeedOrder {
  id: string;
  customer: CustomerName;
  placedOn: string;
  amountCents: number;
  status: OrderStatus;
  tags: OrderTag[];
  note: string;
}

function generateOrders(seed: number): SeedOrder[] {
  // Its own PRNG stream, so the users and facts seedBase writes stay byte-identical to L1.
  const rng = createRng((seed ^ nameHash("orders")) >>> 0);
  const anchors = new Map<string, OrderAnchor>(Object.values(ORDER_ANCHORS).map((a) => [a.id, a]));
  const anchorPairs = new Set([...anchors.values()].map((a) => `${a.customer}|${a.placedOn}`));
  const amounts = new Set<number>();
  const rows: SeedOrder[] = [];
  for (let i = 0; i < ORDER_COUNT; i++) {
    const id = `ord_${FIRST_ORDER_NUMBER + i}`;
    let customer: CustomerName = rng.pick(CUSTOMER_NAMES);
    let placedOn = addDays(FIRST_ORDER_DATE, rng.int(0, ORDER_DATE_SPAN - 1));
    // No generated order may share an anchor's (customer, date), so task wording stays unambiguous.
    while (!anchors.has(id) && anchorPairs.has(`${customer}|${placedOn}`)) {
      customer = rng.pick(CUSTOMER_NAMES);
      placedOn = addDays(FIRST_ORDER_DATE, rng.int(0, ORDER_DATE_SPAN - 1));
    }
    let amountCents = rng.int(1500, 98000);
    while (amounts.has(amountCents)) amountCents = rng.int(1500, 98000);
    amounts.add(amountCents);
    const status = rng.pick(["paid", "paid", "shipped", "shipped", "cancelled"] as const);
    const tags = ORDER_TAGS.filter(() => rng.next() < 0.15);
    const anchor = anchors.get(id);
    rows.push(
      anchor
        ? { ...anchor, amountCents, tags: [...anchor.tags] }
        : { id, customer, placedOn, amountCents, status, tags, note: "" },
    );
  }
  // Exactly PENDING_ORDER_COUNT generated (non-anchor) orders start pending.
  const candidates = rows.filter((r) => !anchors.has(r.id));
  for (let n = 0; n < PENDING_ORDER_COUNT; n++) {
    const picked = candidates.splice(rng.int(0, candidates.length - 1), 1)[0];
    if (picked) picked.status = "pending";
  }
  return rows;
}

/** Gives every user without a settings row the defaults. */
export function ensureSettings(db: Database): void {
  db.query(
    `insert or ignore into user_settings
       (user_id, compact_tables, email_limit, digest, webhook_secret_version, api_key_revoked)
     select id, $compact, $limit, $digest, $version, $revoked from users order by id`,
  ).run({
    compact: DEFAULT_SETTINGS.compactTables ? 1 : 0,
    limit: DEFAULT_SETTINGS.emailLimit,
    digest: DEFAULT_SETTINGS.digest,
    version: DEFAULT_SETTINGS.webhookSecretVersion,
    revoked: DEFAULT_SETTINGS.apiKeyRevoked ? 1 : 0,
  });
}

/** Seeds customers, orders, settings and Alice's bio. Runs after the users exist. */
export function seedShop(db: Database, seed: number, aliceId: number): void {
  CUSTOMER_NAMES.forEach((name, i) => {
    db.query("insert into customers (id, name, email) values ($id, $name, $email)").run({
      id: i + 1,
      name,
      email: customerEmail(name),
    });
  });
  for (const r of generateOrders(seed)) {
    db.query(
      `insert into orders (id, customer_id, placed_on, amount_cents, status, note, tags)
       values ($id, $customerId, $placedOn, $amountCents, $status, $note, $tags)`,
    ).run({
      id: r.id,
      customerId: CUSTOMER_NAMES.indexOf(r.customer) + 1,
      placedOn: r.placedOn,
      amountCents: r.amountCents,
      status: r.status,
      note: r.note,
      tags: JSON.stringify(r.tags),
    });
  }
  ensureSettings(db);
  db.query("insert into bios (user_id, html) values ($userId, $html)").run({
    userId: aliceId,
    html: ALICE_BIO_HTML,
  });
}
