// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Shared test helpers (not exported from the package): a fixture server on 127.0.0.1 and a headless
// browser launcher that prefers the installed Chrome.
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { chromium } from "playwright-core";
import { detectBrowsers } from "../browser/detect-browsers.ts";
import { nodeBrowserHost } from "../browser/host.ts";
import { bundledChromiumPath } from "../browser/launch-persistent.ts";

const FIXTURES = join(import.meta.dirname, "__fixtures__");

export interface FixtureServer {
  /** e.g. http://127.0.0.1:41234 */
  origin: string;
  /** Same server under another origin (http://localhost:<port>), outside the allowlist. */
  otherOrigin: string;
  close(): Promise<void>;
}

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${body}</main></body></html>`;

export async function startFixtureServer(): Promise<FixtureServer> {
  let port = 0;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, type: string, body: string) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    if (url.pathname === "/dashboard") {
      // Drain the form body without echoing it.
      req.resume();
      req.on("end", () => send(200, "text/html", page("Dashboard", "<h1>Dashboard</h1><p>Signed in</p>")));
      return;
    }
    if (url.pathname === "/slow-api") {
      setTimeout(() => send(200, "application/json", JSON.stringify({ message: "Data loaded" })), 1200);
      return;
    }
    if (url.pathname === "/redirect-away") {
      res.writeHead(302, { location: `http://localhost:${port}/elsewhere` });
      res.end();
      return;
    }
    if (url.pathname === "/elsewhere") return send(200, "text/html", page("Elsewhere", "<h1>Elsewhere</h1>"));
    if (url.pathname === "/help" || url.pathname === "/privacy")
      return send(200, "text/html", page("Help", "<h1>Help</h1>"));
    const name = url.pathname.replace(/^\//, "") || "login.html";
    if (!/^[a-z-]+\.html$/.test(name)) return send(404, "text/plain", "not found");
    try {
      const html = readFileSync(join(FIXTURES, name), "utf8").replaceAll(
        "__OTHER_ORIGIN__",
        `http://localhost:${port}`,
      );
      return send(200, "text/html", html);
    } catch {
      return send(404, "text/plain", "not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    otherOrigin: `http://localhost:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type BrowserLaunch = { channel: "chrome" } | { executablePath: string };

/** Installed Chrome first, then Playwright's Chromium; undefined when neither exists. */
export async function findTestBrowser(): Promise<BrowserLaunch | undefined> {
  const installed = await detectBrowsers(nodeBrowserHost());
  if (installed.some((b) => b.kind === "chrome")) return { channel: "chrome" };
  const bundled = bundledChromiumPath();
  return bundled ? { executablePath: bundled } : undefined;
}

export function launchTestBrowser(how: BrowserLaunch): Promise<Browser> {
  return chromium.launch({ headless: true, ...how });
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}
