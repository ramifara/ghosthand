// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Real launch through P0-07's persistent profiles, in a temp profile store. Skipped in CI and without Chrome.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectBrowsers } from "../browser/detect-browsers.ts";
import { nodeBrowserHost } from "../browser/host.ts";
import { openProfileStore } from "../browser/profile-store.ts";
import { launchWebComputer } from "./launch-web-computer.ts";
import type { FixtureServer } from "./test-support.ts";
import { startFixtureServer } from "./test-support.ts";

const host = nodeBrowserHost();
const chromeInstalled = (await detectBrowsers(host)).some((b) => b.kind === "chrome");
const skip =
  (process.env.CI !== undefined && process.env.GHOSTHAND_BROWSER_TESTS !== "1") || !chromeInstalled;

describe.skipIf(skip)("launchWebComputer", () => {
  let tmp: string;
  let server: FixtureServer;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "ghosthand-web-launch-"));
    server = await startFixtureServer();
  });

  afterAll(async () => {
    await server.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("launches Chrome with a profile and drives a page", async () => {
    const launched = await launchWebComputer({
      profile: "web",
      channel: "chrome",
      headless: true,
      viewport: { width: 1024, height: 700 },
      store: openProfileStore({ root: join(tmp, "profiles") }),
      host,
      startUrl: server.origin,
      // An explicit allowlist: without one a goal may go to any site (ADR 0016).
      allowOrigins: [server.origin],
    });
    if (!launched.ok) throw new Error(`${launched.error.kind}: ${launched.error.message}`);
    const { computer, browserInfo } = launched.value;
    try {
      expect(browserInfo.kind).toBe("chrome");
      expect((await computer.open(`${server.origin}/table.html`)).ok).toBe(true);
      const s = await computer.observe();
      expect(s.ok && s.value.elements.filter((e) => e.name === "Edit").length).toBe(3);
      expect(s.ok && s.value.elements.find((e) => e.name === "Edit")?.context).toContain("Alice Martin");
      expect((await computer.open(`${server.otherOrigin}/elsewhere`)).ok).toBe(false);
    } finally {
      await computer.close();
    }
  }, 120_000);
});
