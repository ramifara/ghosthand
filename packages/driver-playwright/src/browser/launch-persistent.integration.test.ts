// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Launches the installed Chrome headless with named profiles in a temp store. Skipped in CI and
// when Chrome is not installed. Never touches the user's real Chrome or GhostHand profiles.

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectBrowsers } from "./detect-browsers.ts";
import { nodeBrowserHost } from "./host.ts";
import { importChromeProfile } from "./import-chrome-profile.ts";
import type { LaunchPersistentOptions } from "./launch-persistent.ts";
import { launchPersistent } from "./launch-persistent.ts";
import type { ProfileStore } from "./profile-store.ts";
import { openProfileStore } from "./profile-store.ts";

const host = nodeBrowserHost();
const chromeInstalled = (await detectBrowsers(host)).some((browser) => browser.kind === "chrome");
const skip = process.env.CI !== undefined || !chromeInstalled;

function startServer(): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.url === "/login") {
      res.setHeader("Set-Cookie", "gh_session=signed-in; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax");
      res.setHeader("Content-Type", "text/html");
      res.end("<h1>logged in</h1>");
      return;
    }
    const signedIn = (req.headers.cookie ?? "").includes("gh_session=signed-in");
    res.setHeader("Content-Type", "text/html");
    res.end(`<h1 id="state">${signedIn ? "welcome back" : "please log in"}</h1>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

describe.skipIf(skip)("launchPersistent with installed Chrome", () => {
  let tmp: string;
  let store: ProfileStore;
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "ghosthand-launch-"));
    store = openProfileStore({ root: join(tmp, "profiles") });
    server = await startServer();
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(tmp, { recursive: true, force: true });
  });

  const base = (profile: string): LaunchPersistentOptions => ({
    profile,
    channel: "chrome",
    headless: true,
    viewport: { width: 1024, height: 700 },
    store,
    host,
    timeoutMs: 30_000,
  });

  async function pageState(profile: string): Promise<string> {
    const launched = await launchPersistent(base(profile));
    if (!launched.ok) throw new Error(`launch failed: ${launched.error.kind}: ${launched.error.message}`);
    const { context } = launched.value;
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${origin}/`);
      return (await page.textContent("#state")) ?? "";
    } finally {
      await context.close();
    }
  }

  async function logIn(profile: string): Promise<void> {
    const launched = await launchPersistent(base(profile));
    if (!launched.ok) throw new Error(`launch failed: ${launched.error.kind}: ${launched.error.message}`);
    const { context, browserInfo } = launched.value;
    try {
      expect(browserInfo.kind).toBe("chrome");
      expect(browserInfo.bundled).toBe(false);
      expect(browserInfo.userDataDir).toBe(join(store.root, profile));
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${origin}/`);
      expect(await page.textContent("#state")).toBe("please log in");
      await page.goto(`${origin}/login`);
    } finally {
      await context.close();
    }
  }

  it("keeps a login across two runs of the same profile", async () => {
    await logIn("persist");
    expect(await pageState("persist")).toBe("welcome back");
    const listed = await store.list();
    expect(listed.ok && listed.value.find((p) => p.name === "persist")?.lastUsedAt).toBeTruthy();
  }, 120_000);

  it("refuses to open a profile that is already open", async () => {
    const first = await launchPersistent(base("busy"));
    if (!first.ok) throw new Error(first.error.message);
    try {
      const second = await launchPersistent(base("busy"));
      expect(!second.ok && second.error.kind).toBe("profile_locked");
      const copySource = await importChromeProfile(first.value.browserInfo.userDataDir, "busy-copy", {
        store,
      });
      expect(!copySource.ok && copySource.error.kind).toBe("profile_locked");
    } finally {
      await first.value.context.close();
    }
  }, 120_000);

  it("carries cookies through an import of a copied profile", async () => {
    await logIn("source");
    // Copy the closed profile somewhere else, as if it were a Chrome user-data-dir, then import it.
    const fakeChrome = join(tmp, "fake-chrome-user-data");
    cpSync(join(store.root, "source"), fakeChrome, { recursive: true, verbatimSymlinks: true });
    const imported = await importChromeProfile(fakeChrome, "imported", { store });
    if (!imported.ok) throw new Error(`${imported.error.kind}: ${imported.error.message}`);
    expect(await pageState("imported")).toBe("welcome back");
  }, 120_000);
});
