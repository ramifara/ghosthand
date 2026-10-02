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
import { SecretsRegistry } from "@ghosthand/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchWebComputer } from "../web/launch-web-computer.ts";
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

  it("reduces the webdriver marker while keeping locale, timezone and native properties stable across launches", async () => {
    const identities: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      const launched = await launchPersistent({
        ...base("compatibility"),
        behavior: {
          reduceAutomationMarkers: true,
          nativeWindow: true,
          locale: "de-DE",
          timezoneId: "Europe/Berlin",
        },
      });
      if (!launched.ok) throw new Error(launched.error.message);
      try {
        const page = launched.value.context.pages()[0] ?? (await launched.value.context.newPage());
        await page.goto(origin);
        expect(page.viewportSize()).toBeNull();
        const identity = await page.evaluate(() => ({
          webdriver: navigator.webdriver,
          language: navigator.language,
          languages: navigator.languages,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          plugins: navigator.plugins.length,
          screen: [screen.width, screen.height],
        }));
        expect(identity.webdriver).toBe(false);
        expect(identity.language).toBe("de-DE");
        expect(identity.languages[0]).toBe("de-DE");
        expect(identity.timezone).toBe("Europe/Berlin");
        identities.push(identity);
        await page.setContent('<iframe srcdoc="<p>frame</p>"></iframe>');
        expect(await page.frames()[1]?.evaluate(() => navigator.webdriver)).toBe(false);
      } finally {
        await launched.value.context.close();
      }
    }
    expect(identities[0]).toEqual(identities[1]);
  }, 60_000);

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

  it("imports prepared clearance and user agent while preserving an existing profile login", async () => {
    await logIn("prepared");
    const requests: unknown[] = [];
    const solver = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/v1") {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status: "ok",
          solution: {
            url: `${origin}/`,
            status: 200,
            userAgent: "GhostHand external preparation test",
            cookies: [
              {
                name: "cf_clearance",
                value: "clearance-value-from-service",
                domain: "127.0.0.1",
                path: "/",
                httpOnly: true,
              },
              { name: "gh_session", value: "guest", domain: "127.0.0.1", path: "/" },
              { name: "foreign", value: "foreign-cookie", domain: "foreign.test", path: "/" },
            ],
          },
        }),
      );
    });
    await new Promise<void>((resolve) => solver.listen(0, "127.0.0.1", resolve));
    const secrets = new SecretsRegistry();
    try {
      const launched = await launchWebComputer({
        ...base("prepared"),
        startUrl: `${origin}/`,
        secrets,
        network: {
          flaresolverr: {
            enabled: true,
            endpoint: `http://127.0.0.1:${(solver.address() as AddressInfo).port}`,
            origins: [origin],
          },
        },
      });
      if (!launched.ok) throw new Error(launched.error.message);
      const { computer } = launched.value;
      try {
        expect((await computer.open(`${origin}/`)).ok).toBe(true);
        expect(await computer.page.textContent("#state")).toBe("welcome back");
        expect(await computer.page.evaluate(() => navigator.userAgent)).toBe(
          "GhostHand external preparation test",
        );
        const cookies = await computer.page.context().cookies();
        expect(cookies.find((cookie) => cookie.name === "cf_clearance")?.value).toBe(
          "clearance-value-from-service",
        );
        expect(cookies.find((cookie) => cookie.name === "gh_session")?.value).toBe("signed-in");
        expect(cookies.find((cookie) => cookie.name === "foreign")).toBeUndefined();
        expect(secrets.redact("clearance-value-from-service")).toMatch(/^\[input:flaresolverr.cookie\./);
        await computer.page.reload();
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ cmd: "request.get", url: `${origin}/`, returnOnlyCookies: true });
        expect(requests[0]).not.toHaveProperty("cookies");
      } finally {
        await computer.close();
      }
    } finally {
      await new Promise((resolve) => solver.close(resolve));
    }
  }, 60_000);

  it("routes browser traffic through the configured HTTP proxy", async () => {
    const requests: string[] = [];
    const proxy = createServer((req, res) => {
      requests.push(req.url ?? "");
      res.setHeader("Content-Type", "text/html");
      res.end("<h1>served through proxy</h1>");
    });
    proxy.on("connect", (_req, socket) => socket.destroy());
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    try {
      const launched = await launchWebComputer({
        ...base("proxy"),
        startUrl: "http://ghosthand-proxy.test/check",
        network: {
          proxy: { enabled: true, server: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}` },
        },
      });
      if (!launched.ok) throw new Error(launched.error.message);
      try {
        expect((await launched.value.computer.open("http://ghosthand-proxy.test/check")).ok).toBe(true);
        expect(await launched.value.computer.page.textContent("h1")).toBe("served through proxy");
        expect(requests).toContain("http://ghosthand-proxy.test/check");
      } finally {
        await launched.value.computer.close();
      }
    } finally {
      await new Promise((resolve) => proxy.close(resolve));
    }
  }, 60_000);

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
