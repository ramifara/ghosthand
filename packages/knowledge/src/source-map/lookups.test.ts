// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { elementsApp } from "./__fixtures__/elements-app.ts";
import { routesApp } from "./__fixtures__/routes-app.ts";
import { buildSourceMap } from "./build-source-map.ts";
import { findSourceElements, matchesPattern, routeIndex, testidIndex } from "./lookups.ts";
import { matchRoute, pathOf, routeScore } from "./match-route.ts";

const map = buildSourceMap(elementsApp, { root: "/v", generatedAt: "2026-10-01T00:00:00.000Z" });
const routed = buildSourceMap(routesApp, { root: "/v", generatedAt: "2026-10-01T00:00:00.000Z" });

describe("lookups", () => {
  it("indexes testids to file:line", () => {
    const index = testidIndex(map);
    expect(index.get("inbox.list")).toEqual(["inbox.tsx:17"]);
    expect(index.get("inbox.message.*")).toEqual(["inbox.tsx:19"]);
  });

  it("joins runtime elements by testid, testid pattern, then role + name", () => {
    expect(findSourceElements(map, { testid: "inbox.list" })[0]?.ariaLabel).toBe("Messages");
    expect(findSourceElements(map, { testid: "inbox.message.42" })[0]?.testidPattern).toBe("inbox.message.*");
    expect(findSourceElements(map, { role: "button", name: "send  REPLY" })[0]?.testid).toBe("inbox.reply");
    expect(findSourceElements(map, { role: "button", name: "Sending…" })[0]?.testid).toBe("inbox.reply");
    expect(findSourceElements(map, { role: "textbox", name: "Email address" })[0]?.testid).toBe(
      "signup.email",
    );
    expect(findSourceElements(map, { role: "link", name: "Email address" })).toEqual([]);
    expect(findSourceElements(map, { testid: "nope", name: "Archive" })[0]?.testid).toBe("inbox.archive");
    expect(findSourceElements(map, {})).toEqual([]);
  });

  it("matches testid patterns", () => {
    expect(matchesPattern("orders.row.*", "orders.row.ORD-1")).toBe(true);
    expect(matchesPattern("orders.row.*", "orders.rows")).toBe(false);
    expect(matchesPattern("*.open", "from.open")).toBe(true);
  });
});

describe("matchRoute", () => {
  it("prefers static over param over splat", () => {
    expect(matchRoute(routed, "/settings/billing")?.path).toBe("/settings/billing");
    expect(matchRoute(routed, "http://127.0.0.1:4400/orders/ORD-7?x=1#y")?.path).toBe("/orders/:id");
    expect(matchRoute(routed, "/nope/deeper")?.path).toBe("/*");
    expect(matchRoute(routed, "/")?.path).toBe("/");
    expect(routeIndex(routed).get("/admin/users")?.component).toBe("Users");
  });

  it("normalizes paths and scores patterns", () => {
    expect(pathOf("settings/")).toBe("/settings");
    expect(pathOf("https://x.test/a/b/?q")).toBe("/a/b");
    expect(routeScore("/a/:id", "/a/1")).toBeGreaterThan(routeScore("/*", "/a/1") ?? 0);
    expect(routeScore("/a", "/a/1")).toBeUndefined();
  });
});
