// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Maps `app://ghosthand/<path>` to a file inside the bundled renderer folder. Pure, so the traversal
// guard is unit-tested; the protocol handler in app-protocol.ts does the I/O.
import { extname, normalize, resolve, sep } from "node:path";
import { APP_HOST, APP_SCHEME } from "./sender-guard.ts";

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".map": "application/json",
};

export function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Returns the absolute file for a request URL, or undefined when it is outside `root` or malformed. */
export function resolveAppAsset(root: string, requestUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return undefined;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  if (pathname.includes("\0")) return undefined;
  const relative = pathname === "/" || pathname === "" ? "index.html" : pathname.replace(/^\/+/, "");
  const base = resolve(root);
  const file = resolve(base, normalize(relative));
  if (file !== base && !file.startsWith(base + sep)) return undefined;
  return file;
}
