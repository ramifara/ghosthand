// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { answerMentionsOrder } from "./oracle-helpers.ts";
import {
  formatMoney,
  moneyMentions,
  type OrderRow,
  OrdersQuery,
  queryOrders,
  revenueBetween,
} from "./orders.ts";
import { richTextPlain, richTextRuns, sanitizeRichText } from "./rich-text.ts";

function order(id: number, overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: `ord_${1000 + id}`,
    customerId: 1,
    customerName: "Bob Ng",
    placedOn: "2026-01-10",
    amountCents: 1000 * id,
    status: "paid",
    note: "",
    tags: [],
    deletedAt: null,
    ...overrides,
  };
}

describe("queryOrders", () => {
  const rows = Array.from({ length: 25 }, (_, i) =>
    order(i + 1, { placedOn: `2026-01-${String((i % 5) + 10).padStart(2, "0")}` }),
  );

  it("pages by ten and clamps the page", () => {
    const p3 = queryOrders(rows, OrdersQuery.parse({ page: "3" }));
    expect(p3).toMatchObject({ page: 3, pageCount: 3, total: 25 });
    expect(p3.orders).toHaveLength(5);
    expect(queryOrders(rows, OrdersQuery.parse({ page: "9" })).page).toBe(3);
  });

  it("breaks ties on id ascending in both directions", () => {
    const desc = queryOrders(rows, OrdersQuery.parse({ sort: "placedOn", dir: "desc" })).orders;
    expect(desc.slice(0, 5).map((o) => o.id)).toEqual([
      "ord_1005",
      "ord_1010",
      "ord_1015",
      "ord_1020",
      "ord_1025",
    ]);
  });

  it("hides deleted orders and filters by status and text", () => {
    const mixed = [
      order(1),
      order(2, { deletedAt: "x" }),
      order(3, { status: "pending", customerName: "Hana Sato" }),
    ];
    expect(queryOrders(mixed, OrdersQuery.parse({})).total).toBe(2);
    expect(queryOrders(mixed, OrdersQuery.parse({ status: "pending" })).orders.map((o) => o.id)).toEqual([
      "ord_1003",
    ]);
    expect(queryOrders(mixed, OrdersQuery.parse({ q: "hana" })).total).toBe(1);
    expect(OrdersQuery.parse({ sort: "nope", status: "lost", page: "-2" })).toMatchObject({
      sort: "id",
      page: 1,
      status: undefined,
    });
  });
});

describe("money", () => {
  it("formats and parses amounts", () => {
    expect(formatMoney(1234567)).toBe("$12,345.67");
    expect(formatMoney(5)).toBe("$0.05");
    expect(moneyMentions("Total revenue: $12,345.67 across 9 orders")).toContain(1234567);
    expect(moneyMentions("12345.6")).toContain(1234560);
  });

  it("revenue excludes cancelled and deleted orders and includes both ends", () => {
    const rows = [
      order(1, { placedOn: "2026-01-12" }),
      order(2, { placedOn: "2026-01-25" }),
      order(3, { placedOn: "2026-01-20", status: "cancelled" }),
      order(4, { placedOn: "2026-01-20", deletedAt: "x" }),
      order(5, { placedOn: "2026-01-26" }),
    ];
    expect(revenueBetween(rows, "2026-01-12", "2026-01-25")).toMatchObject({ count: 2, totalCents: 3000 });
  });
});

describe("answerMentionsOrder", () => {
  it("accepts one matching order id in several spellings", () => {
    expect(answerMentionsOrder("It's ord_1022.", "ord_1022")).toBe(true);
    expect(answerMentionsOrder("ORD-1022", "ord_1022")).toBe(true);
    expect(answerMentionsOrder("1022", "ord_1022")).toBe(true);
    expect(answerMentionsOrder("ord_10220", "ord_1022")).toBe(false);
    expect(answerMentionsOrder("ord_1022 or ord_1013", "ord_1022")).toBe(false);
    expect(answerMentionsOrder(undefined, "ord_1022")).toBe(false);
  });
});

describe("rich text", () => {
  it("keeps only p, br, strong and em, without attributes", () => {
    expect(
      sanitizeRichText('<p class="x" onclick="evil()">Hi <b>there</b><img src=x onerror=alert(1)></p>'),
    ).toBe("<p>Hi <strong>there</strong></p>");
    expect(sanitizeRichText("<div>One</div><div>Two<br></div>")).toBe("<p>One</p><p>Two<br></p>");
    expect(sanitizeRichText("<p>a <script>alert(1)</script>b &amp; &lt;c&gt;&nbsp;d</p>")).toBe(
      "<p>a b &amp; &lt;c&gt; d</p>",
    );
    expect(sanitizeRichText("<p><strong>unclosed <em>nest</p>")).toBe(
      "<p><strong>unclosed <em>nest</em></strong></p>",
    );
    expect(sanitizeRichText("<p><b></b>x</p><p> </p>")).toBe("<p>x</p>");
  });

  it("reads plain text and formatted runs", () => {
    const html =
      "<p>I build test <strong>fixtures</strong> for you.</p><p>Ask about <em>flaky</em> things.</p>";
    expect(richTextPlain(html)).toBe("I build test fixtures for you. Ask about flaky things.");
    expect(richTextRuns(html, "strong")).toEqual(["fixtures"]);
    expect(richTextRuns(html, "em")).toEqual(["flaky"]);
    expect(richTextRuns("<p><strong>fix</strong><strong>tures </strong>x</p>", "strong")).toEqual([
      "fixtures",
    ]);
  });
});
