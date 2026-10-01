// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { isAppUrl, isTrustedSender } from "./sender-guard.ts";

describe("isTrustedSender", () => {
  it("accepts the app origin from the top-level frame only", () => {
    expect(isTrustedSender({ url: "app://ghosthand/index.html#/live", isMainFrame: true })).toBe(true);
    expect(isTrustedSender({ url: "app://ghosthand/index.html", isMainFrame: false })).toBe(false);
    expect(isTrustedSender({ url: undefined, isMainFrame: true })).toBe(false);
  });

  it("rejects other origins, schemes and look-alikes", () => {
    for (const url of [
      "app://evil/index.html",
      "app://ghosthand.evil/index.html",
      "https://ghosthand/index.html",
      "file:///home/x/index.html",
      "http://127.0.0.1:5180/",
      "devtools://devtools/bundled/inspector.html",
      "not a url",
    ]) {
      expect(isTrustedSender({ url, isMainFrame: true }), url).toBe(false);
    }
  });

  it("accepts the dev server origin only when configured and on loopback", () => {
    const policy = { devOrigin: "http://127.0.0.1:5180" };
    expect(isTrustedSender({ url: "http://127.0.0.1:5180/#/", isMainFrame: true }, policy)).toBe(true);
    expect(isTrustedSender({ url: "http://127.0.0.1:5181/", isMainFrame: true }, policy)).toBe(false);
    expect(
      isTrustedSender(
        { url: "http://10.0.0.5:5180/", isMainFrame: true },
        { devOrigin: "http://10.0.0.5:5180" },
      ),
    ).toBe(false);
  });

  it("uses the same rule for navigation", () => {
    expect(isAppUrl("app://ghosthand/index.html")).toBe(true);
    expect(isAppUrl("https://example.com")).toBe(false);
  });
});
