// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { routesApp } from "./__fixtures__/routes-app.ts";
import { buildSourceMap } from "./build-source-map.ts";
import { joinRoutePath } from "./extract-routes.ts";

const map = buildSourceMap(routesApp, { root: "/virtual", generatedAt: "2026-10-01T00:00:00.000Z" });
const route = (path: string) => map.routes.find((r) => r.path === path);

describe("route extraction", () => {
  it("flattens nested JSX routes with index, params and splat", () => {
    expect(map.routes.map((r) => r.path).sort()).toEqual([
      "/",
      "/*",
      "/admin",
      "/admin/users",
      "/orders/:id",
      "/reports/*",
      "/reports/daily",
      "/settings",
      "/settings/billing",
    ]);
    expect(route("/")).toMatchObject({
      component: "HomePage",
      index: true,
      layouts: ["Shell"],
      file: "app.tsx",
    });
    expect(route("/settings")).toMatchObject({
      component: "ProfileSettings",
      componentFile: "pages/settings/profile.tsx",
      layouts: ["Shell", "SettingsLayout"],
      index: true,
    });
    expect(route("/settings/billing")).toMatchObject({
      component: "BillingSettings",
      componentFile: "pages/settings/billing.tsx",
      line: 19,
    });
  });

  it("nests descendant <Routes> under the splat route that renders them", () => {
    expect(route("/reports/daily")).toMatchObject({
      component: "Daily",
      componentFile: "reports/daily.tsx",
      layouts: ["Shell", "ReportsRoutes"],
      file: "reports/reports-routes.tsx",
    });
    expect(map.routes.some((r) => r.path === "/daily")).toBe(false);
    // The splat itself mounts ReportsRoutes, which imports Daily, so it can render it too.
    expect(map.elements.find((e) => e.text === "Daily report")?.routes).toEqual([
      "/reports/*",
      "/reports/daily",
    ]);
  });

  it("reads route objects passed to createBrowserRouter", () => {
    expect(route("/admin")).toMatchObject({ component: "Admin", index: true, file: "object-router.tsx" });
    expect(route("/admin/users")).toMatchObject({ component: "Users", componentFile: "admin/users.tsx" });
  });

  it("maps elements to the routes that can render them through imports and layouts", () => {
    const nav = map.elements.find((e) => e.testid === "nav.settings");
    expect(nav?.routes.sort()).toEqual([
      "/",
      "/*",
      "/orders/:id",
      "/reports/*",
      "/reports/daily",
      "/settings",
      "/settings/billing",
    ]);
    const save = map.elements.find((e) => e.testid === "settings.save");
    expect(save?.routes).toEqual(["/settings"]);
    const pay = map.elements.find((e) => e.testid === "billing.pay");
    expect(pay).toMatchObject({ routes: ["/settings/billing"], risk: "external" });
    const remove = map.elements.find((e) => e.name === "Remove user");
    expect(remove).toMatchObject({ routes: ["/admin/users"], risk: "destructive" });
    expect(map.modules.find((m) => m.file === "components/save-button.tsx")?.routes).toEqual(["/settings"]);
  });

  it("joins route paths", () => {
    expect(joinRoutePath("/", "a")).toBe("/a");
    expect(joinRoutePath("/a", "b/")).toBe("/a/b");
    expect(joinRoutePath("/a", "/abs")).toBe("/abs");
    expect(joinRoutePath("/a", undefined)).toBe("/a");
  });
});
