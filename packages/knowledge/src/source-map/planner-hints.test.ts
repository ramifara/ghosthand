// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { elementsApp } from "./__fixtures__/elements-app.ts";
import { routesApp } from "./__fixtures__/routes-app.ts";
import { buildSourceMap } from "./build-source-map.ts";
import { formatSourceMapSummary } from "./format-summary.ts";
import { plannerContext, seedTargetsFor } from "./planner-hints.ts";
import { expectedTestidsForRoute } from "./source-oracles.ts";

const map = buildSourceMap(elementsApp, { root: "/v", generatedAt: "2026-10-01T00:00:00.000Z" });
const routed = buildSourceMap(routesApp, { root: "/v", generatedAt: "2026-10-01T00:00:00.000Z" });

describe("planner helpers", () => {
  it("seeds targets on the current route by word overlap with the goal", () => {
    // Interactive matches (tab, button) rank before the list; ties keep document order.
    expect(seedTargetsFor(map, { url: "/inbox", goal: "Archive the starred messages" })).toEqual([
      "Starred",
      "Archive",
      "Messages",
    ]);
    expect(seedTargetsFor(map, { url: "/signup", goal: "Enter my email address" })).toEqual([
      "Email address",
    ]);
    expect(seedTargetsFor(map, { url: "/inbox", goal: "the" })).toEqual([]);
    expect(seedTargetsFor(map, { url: "/inbox", goal: "messages" }, 1)).toHaveLength(1);
  });

  it("builds a compact context with routes, forms and testids", () => {
    const ctx = plannerContext(map, "/signup");
    expect(ctx.split("\n")[0]).toBe("App routes (from source): /inbox (InboxPage), /signup (SignupPage)");
    expect(ctx).toContain("Current route: /signup -> SignupPage");
    expect(ctx).toContain(
      'Form [signup.form]: Email address, About you, Accept terms, plan, Find a team; submit "Create account"',
    );
    expect(ctx).toContain('- button "Create account" [signup.submit]');
    const short = plannerContext(map, "/inbox", 200);
    expect(short.length).toBeLessThanOrEqual(200);
    expect(short.endsWith("...")).toBe(true);
    expect(plannerContext(map, "/elsewhere")).toContain("Current route: unknown");
  });

  it("lists shared chrome after route-specific elements", () => {
    const ctx = plannerContext(routed, "/settings");
    expect(ctx.indexOf("[settings.save]")).toBeLessThan(ctx.indexOf("Shared (every page):"));
    expect(ctx).toContain('link "Settings" [nav.settings]');
  });

  it("lists expected testids per route", () => {
    expect(expectedTestidsForRoute(routed, "/settings")).toEqual(["nav.settings", "settings.save"]);
    expect(expectedTestidsForRoute(routed, "/settings/billing?x=1")).toEqual(["billing.pay", "nav.settings"]);
    expect(expectedTestidsForRoute(routed, "/admin/users")).toEqual([]);
  });

  it("summarizes a map", () => {
    const text = formatSourceMapSummary(routed);
    expect(text).toContain("9 routes");
    expect(text).toContain("Risk: 1 destructive, 1 external");
    expect(text).toContain("/settings/billing -> BillingSettings  (app.tsx:19)");
    expect(text.split("\n")).toContain("  nav.settings  shell.tsx:3");
  });
});
