// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// CSP, app:// asset resolution and the external-link allow-list.
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mimeFor, resolveAppAsset } from "./app-asset.ts";
import { buildCsp } from "./csp.ts";
import { CHATGPT_MANAGE_USAGE_URL, isAllowedExternalUrl } from "./external-links.ts";

describe("buildCsp", () => {
  it("is strict in production", () => {
    const csp = buildCsp({ dev: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' data: blob:");
  });

  it("allows only the loopback dev server in dev", () => {
    const csp = buildCsp({ dev: true, devOrigin: "http://127.0.0.1:5180" });
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:5180 ws://127.0.0.1:5180");
    expect(csp).not.toContain("unsafe-eval");
  });
});

describe("resolveAppAsset", () => {
  const root = resolve("/opt/ghosthand/out/renderer");
  it("maps app:// paths into the renderer folder", () => {
    expect(resolveAppAsset(root, "app://ghosthand/")).toBe(join(root, "index.html"));
    expect(resolveAppAsset(root, "app://ghosthand/assets/index-abc.js")).toBe(
      join(root, "assets/index-abc.js"),
    );
  });

  it("refuses traversal, other hosts and other schemes", () => {
    for (const url of [
      "app://ghosthand/../secrets.json",
      "app://ghosthand/%2e%2e/%2e%2e/etc/passwd",
      "app://ghosthand/assets/%00.js",
      "app://other/index.html",
      "file:///etc/passwd",
      "app://ghosthand/%E0%A4%A",
    ]) {
      const r = resolveAppAsset(root, url);
      expect(r === undefined || r.startsWith(root), url).toBe(true);
    }
    expect(resolveAppAsset(root, "app://other/index.html")).toBeUndefined();
    expect(resolveAppAsset(root, "app://ghosthand/%E0%A4%A")).toBeUndefined();
  });

  it("knows the MIME types the renderer needs", () => {
    expect(mimeFor("a.js")).toMatch(/javascript/);
    expect(mimeFor("a.css")).toMatch(/css/);
    expect(mimeFor("a.bin")).toBe("application/octet-stream");
  });
});

describe("isAllowedExternalUrl", () => {
  it("allows https links to the listed hosts", () => {
    expect(isAllowedExternalUrl(CHATGPT_MANAGE_USAGE_URL)).toBe(true);
    expect(isAllowedExternalUrl("https://github.com/ramifara/ghosthand")).toBe(true);
  });
  it("blocks everything else", () => {
    for (const url of [
      "http://chatgpt.com/",
      "https://chatgpt.com.evil.io/",
      "https://user:pw@github.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://example.com",
    ]) {
      expect(isAllowedExternalUrl(url), url).toBe(false);
    }
  });
});
