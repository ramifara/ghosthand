// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Browser test (skipped without a browser, and in CI unless GHOSTHAND_BROWSER_TESTS=1): the error log and
// the axe audit on a fixture page with a console error, a 404 and an image without alt text.
import type { Browser, BrowserContext } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditA11y } from "./audit-a11y.ts";
import { registerGhosthandEngine } from "./engine-client.ts";
import type { BrowserLaunch, FixtureServer } from "./test-support.ts";
import { findTestBrowser, launchTestBrowser, startFixtureServer } from "./test-support.ts";
import { createWebComputer } from "./web-computer.ts";

const how: BrowserLaunch | undefined = await findTestBrowser();
const skip =
  how === undefined || (process.env.CI !== undefined && process.env.GHOSTHAND_BROWSER_TESTS !== "1");

describe.skipIf(skip)("QA probes on a fixture page", () => {
  let browser: Browser;
  let server: FixtureServer;
  let context: BrowserContext | undefined;

  beforeAll(async () => {
    await registerGhosthandEngine();
    if (!how) throw new Error("no browser");
    browser = await launchTestBrowser(how);
    server = await startFixtureServer();
  });

  afterAll(async () => {
    await context?.close();
    await browser?.close();
    await server?.close();
  });

  it("collects console errors and failed responses, and audits with axe", async () => {
    context = await browser.newContext();
    const created = await createWebComputer({ context, allowOrigins: [server.origin] });
    if (!created.ok) throw new Error(created.error.message);
    const c = created.value;
    const opened = await c.open(`${server.origin}/errors.html`);
    expect(opened.ok).toBe(true);
    const snap = await c.observe();
    if (!snap.ok) throw new Error(snap.error.message);
    const go = snap.value.elements.find((e) => e.name === "Go");
    if (!go) throw new Error("no Go button");
    await c.press(go.token);
    await c.waitIdle({ capMs: 2000 });
    expect(c.consoleErrors.some((e) => e.includes("boom on load"))).toBe(true);
    expect(c.consoleErrors.some((e) => e.includes("boom from button"))).toBe(true);
    expect(c.httpErrors).toContainEqual({ status: 404, method: "GET", url: `${server.origin}/missing-api` });
    const audit = await auditA11y(c.page);
    if (!audit.ok) throw new Error(audit.error.message);
    expect(audit.value.violations.map((v) => v.id)).toContain("image-alt");
    await c.close();
  });
});
