// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `app://ghosthand/` serves the bundled renderer in production with a strict CSP on every response.
import { readFile } from "node:fs/promises";
import { protocol } from "electron";
import { mimeFor, resolveAppAsset } from "./app-asset.ts";
import { buildCsp } from "./csp.ts";
import { APP_SCHEME } from "./sender-guard.ts";

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

export function handleAppProtocol(rendererRoot: string): void {
  const csp = buildCsp({ dev: false });
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppAsset(rendererRoot, request.url);
    if (!file) return new Response("not found", { status: 404 });
    try {
      const body = await readFile(file);
      return new Response(body, {
        headers: {
          "content-type": mimeFor(file),
          "content-security-policy": csp,
          "x-content-type-options": "nosniff",
          "cache-control": "no-cache",
        },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}
