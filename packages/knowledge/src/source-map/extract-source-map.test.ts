// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Runs the extractor on the real testbed web app. Asserts only L1–L3 facts that other work leaves alone.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { extractSourceMap } from "./extract-source-map.ts";
import { formatSourceMapSummary } from "./format-summary.ts";
import { findSourceElements, testidIndex } from "./lookups.ts";
import { plannerContext, seedTargetsFor } from "./planner-hints.ts";
import { SourceMap } from "./source-map-schema.ts";
import { expectedTestidsForRoute } from "./source-oracles.ts";

const testbed = fileURLToPath(new URL("../../../../apps/testbed/web/src", import.meta.url));

describe("extractSourceMap on apps/testbed/web/src", () => {
  let map: SourceMap;
  beforeAll(async () => {
    const res = await extractSourceMap(testbed);
    if (!res.ok) throw new Error(JSON.stringify(res.error));
    map = res.value;
  });

  it("is schema-valid and parses every file", () => {
    expect(SourceMap.safeParse(map).success).toBe(true);
    expect(map.skipped).toEqual([]);
    expect(map.modules.some((m) => m.file.endsWith(".test.ts"))).toBe(false);
  });

  it("finds the React Router routes and their pages", () => {
    const settings = map.routes.find((r) => r.path === "/settings");
    expect(settings).toMatchObject({
      component: "SettingsPage",
      componentFile: "pages/settings-page.tsx",
      layouts: ["AppShell"],
      file: "app.tsx",
    });
    expect(map.routes.find((r) => r.path === "/")).toMatchObject({ component: "HomePage", index: true });
    expect(map.routes.find((r) => r.path === "/login")?.component).toBe("LoginPage");
  });

  it("resolves data-driven nav testids to app-shell.tsx with a line", () => {
    const nav = map.elements.find((e) => e.testid === "nav.settings");
    expect(nav).toMatchObject({ file: "components/app-shell.tsx", role: "link", name: "Settings" });
    expect(nav?.line).toBeGreaterThan(0);
    expect(nav?.routes).toEqual(expect.arrayContaining(["/", "/login", "/settings"]));
    expect(testidIndex(map).get("nav.settings")?.[0]).toMatch(/^components\/app-shell\.tsx:\d+$/);
  });

  it("extracts the login form and its Sign in button", () => {
    const form = map.forms.find((f) => f.testid === "login.form");
    expect(form?.routes).toEqual(["/login"]);
    expect(form?.submitText).toBe("Sign in");
    expect(form?.fields.map((f) => [f.fieldName, f.type, f.label])).toEqual([
      ["email", "email", "Email"],
      ["password", "password", "Password"],
    ]);
    expect(map.elements.find((e) => e.testid === "login.submit")).toMatchObject({
      role: "button",
      text: "Sign in",
      file: "pages/login-page.tsx",
    });
  });

  it("joins runtime elements and tags risky controls", () => {
    expect(findSourceElements(map, { testid: "settings.api-key.revoke" })[0]).toMatchObject({
      name: "Revoke API key",
      risk: "destructive",
      routes: ["/settings"],
    });
    expect(findSourceElements(map, { role: "textbox", name: "Email" })[0]?.testid).toBe("login.email");
  });

  it("feeds planner helpers and oracles", () => {
    expect(expectedTestidsForRoute(map, "/settings")).toEqual(
      expect.arrayContaining(["settings.tab.general", "nav.settings"]),
    );
    expect(expectedTestidsForRoute(map, "/settings")).not.toContain("login.submit");
    expect(
      seedTargetsFor(map, { url: "http://127.0.0.1:4400/login", goal: "Sign in with my email" }),
    ).toEqual(expect.arrayContaining(["Sign in", "Email"]));
    const ctx = plannerContext(map, "http://127.0.0.1:4400/settings");
    expect(ctx.length).toBeLessThanOrEqual(1500);
    expect(ctx).toContain("Current route: /settings -> SettingsPage");
    expect(ctx).toContain("[settings.tab.general]");
    const summary = formatSourceMapSummary(map);
    expect(summary).toMatch(/\d+ routes, \d+ elements \(\d+ testids/);
    expect(summary).toContain("/settings -> SettingsPage");
  });
});

describe("extractSourceMap on disk", () => {
  it("reads locale JSON, skips tests and fixtures, and honors include", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-sourcemap-"));
    try {
      await mkdir(join(dir, "locales"));
      await mkdir(join(dir, "__fixtures__"));
      await writeFile(join(dir, "locales", "en.json"), `{"cta":"Buy now"}`);
      await writeFile(join(dir, "page.tsx"), `export function P() { return <button>{t("cta")}</button>; }\n`);
      await writeFile(join(dir, "page.test.tsx"), `export const x = <button>Test</button>;\n`);
      await writeFile(join(dir, "__fixtures__", "f.tsx"), `export const y = <button>Fixture</button>;\n`);
      await writeFile(join(dir, "package.json"), `{"name":"x"}`);
      const res = await extractSourceMap(dir, { generatedAt: "2026-10-01T00:00:00.000Z" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.modules.map((m) => m.file)).toEqual(["page.tsx"]);
      expect(res.value.elements[0]).toMatchObject({ role: "button", name: "Buy now", risk: "external" });
      expect(res.value.generatedAt).toBe("2026-10-01T00:00:00.000Z");
      const onlyJson = await extractSourceMap(dir, { include: [".json"] });
      expect(onlyJson.ok && onlyJson.value.modules).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing root and records unparsable files", async () => {
    expect(await extractSourceMap("/definitely/not/here")).toEqual({
      ok: false,
      error: { kind: "root-not-found", root: "/definitely/not/here" },
    });
    const dir = await mkdtemp(join(tmpdir(), "gh-sourcemap-"));
    try {
      await writeFile(join(dir, "bad.ts"), "export const = ;;; {{{");
      const res = await extractSourceMap(dir);
      expect(res.ok && res.value.skipped.map((s) => s.file)).toEqual(["bad.ts"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
