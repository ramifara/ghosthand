// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { chooseBrowser } from "./choose-browser.ts";
import type { InstalledBrowser } from "./detect-browsers.ts";
import { browserCandidates, detectBrowsers, whichOnHost } from "./detect-browsers.ts";
import type { BrowserHost, HostPlatform } from "./host.ts";
import { readEnv } from "./host.ts";

function fakeHost(
  platform: HostPlatform,
  executables: readonly string[],
  env: Record<string, string> = {},
  home = platform === "win32" ? "C:\\Users\\rami" : platform === "darwin" ? "/Users/rami" : "/home/rami",
): BrowserHost {
  const files = new Set(executables);
  return {
    platform,
    env,
    homedir: home,
    isExecutable: (path) => files.has(path),
    readVersion: async (path) => (path.includes("brave") ? undefined : "151.0.7922.71"),
  };
}

describe("detectBrowsers", () => {
  it("finds Chrome, Edge and Brave at known Linux paths", async () => {
    const host = fakeHost("linux", [
      "/usr/bin/google-chrome-stable",
      "/usr/bin/microsoft-edge",
      "/opt/brave.com/brave/brave",
    ]);
    const found = await detectBrowsers(host);
    expect(found).toEqual([
      { kind: "chrome", executablePath: "/usr/bin/google-chrome-stable", channel: "chrome" },
      { kind: "msedge", executablePath: "/usr/bin/microsoft-edge", channel: "msedge" },
      { kind: "brave", executablePath: "/opt/brave.com/brave/brave" },
    ]);
  });

  it("prefers the real binary over the wrapper when both exist", async () => {
    const host = fakeHost("linux", ["/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"]);
    const [chrome] = await detectBrowsers(host);
    expect(chrome?.executablePath).toBe("/opt/google/chrome/chrome");
  });

  it("falls back to PATH lookup on Linux", async () => {
    const host = fakeHost("linux", ["/home/rami/.local/bin/brave-browser"], {
      PATH: "/usr/local/bin::/home/rami/.local/bin",
    });
    expect(await detectBrowsers(host)).toEqual([
      { kind: "brave", executablePath: "/home/rami/.local/bin/brave-browser" },
    ]);
  });

  it("finds Windows installs under Program Files and LOCALAPPDATA", async () => {
    const host = fakeHost(
      "win32",
      [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Users\\rami\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      ],
      {
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        LocalAppData: "C:\\Users\\rami\\AppData\\Local",
      },
    );
    const found = await detectBrowsers(host);
    expect(found.map((b) => [b.kind, b.executablePath, b.channel])).toEqual([
      ["chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "chrome"],
      ["msedge", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "msedge"],
      [
        "brave",
        "C:\\Users\\rami\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        undefined,
      ],
    ]);
  });

  it("finds macOS apps in /Applications and ~/Applications", async () => {
    const host = fakeHost("darwin", [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Users/rami/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ]);
    const found = await detectBrowsers(host);
    expect(found.map((b) => b.executablePath)).toEqual([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Users/rami/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ]);
  });

  it("does not use PATH on macOS or Windows", () => {
    expect(browserCandidates("chrome", fakeHost("darwin", [])).commands).toEqual([]);
    expect(browserCandidates("chrome", fakeHost("win32", [])).commands).toEqual([]);
  });

  it("returns an empty list when nothing is installed", async () => {
    expect(await detectBrowsers(fakeHost("linux", [], { PATH: "/usr/bin" }))).toEqual([]);
  });

  it("adds versions only when asked", async () => {
    const host = fakeHost("linux", ["/usr/bin/google-chrome-stable", "/usr/bin/brave-browser"]);
    const found = await detectBrowsers(host, { withVersion: true });
    expect(found[0]?.version).toBe("151.0.7922.71");
    expect(found[1]).not.toHaveProperty("version");
  });
});

describe("whichOnHost and readEnv", () => {
  it("reads Windows env vars case-insensitively", () => {
    const host = fakeHost("win32", ["C:\\tools\\brave.exe"], { Path: "C:\\bin;C:\\tools" });
    expect(readEnv(host, "PATH")).toBe("C:\\bin;C:\\tools");
    expect(whichOnHost("brave.exe", host)).toBe("C:\\tools\\brave.exe");
  });

  it("is case-sensitive elsewhere", () => {
    expect(readEnv(fakeHost("linux", [], { Path: "/x" }), "PATH")).toBeUndefined();
  });
});

describe("chooseBrowser", () => {
  const chrome: InstalledBrowser = { kind: "chrome", executablePath: "/c", channel: "chrome" };
  const edge: InstalledBrowser = { kind: "msedge", executablePath: "/e", channel: "msedge" };
  const brave: InstalledBrowser = { kind: "brave", executablePath: "/b" };

  it("auto prefers chrome > msedge > brave", () => {
    expect(chooseBrowser([brave, edge, chrome], "auto", "/pw")).toEqual({
      ok: true,
      value: { ...chrome, bundled: false },
    });
    expect(chooseBrowser([brave, edge], "auto", "/pw").ok && "msedge").toBe("msedge");
    const onlyBrave = chooseBrowser([brave], "auto", "/pw");
    expect(onlyBrave.ok && onlyBrave.value.executablePath).toBe("/b");
  });

  it("auto falls back to Playwright Chromium only when nothing is installed", () => {
    expect(chooseBrowser([], "auto", "/pw")).toEqual({
      ok: true,
      value: { kind: "chromium", executablePath: "/pw", bundled: true },
    });
  });

  it("reports browser_not_found when nothing is installed and Chromium is not downloaded", () => {
    const result = chooseBrowser([], "auto", undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("browser_not_found");
      expect(result.error.message).toContain("playwright-core install chromium");
    }
  });

  it("honours an explicit channel", () => {
    const result = chooseBrowser([chrome, brave], "brave", "/pw");
    expect(result.ok && result.value.kind).toBe("brave");
    const missing = chooseBrowser([chrome], "msedge", "/pw");
    expect(!missing.ok && missing.error.kind).toBe("browser_not_found");
    const bundled = chooseBrowser([chrome], "chromium", "/pw");
    expect(bundled.ok && bundled.value.bundled).toBe(true);
  });
});
