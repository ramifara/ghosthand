// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Electron hardening (docs/research/notes/monorepo-testbed.md §2): deny every permission, block
// navigation away from the app, deny window.open (allow-listed links go to the system browser), refuse
// <webview>, and add the CSP header in dev (prod serves it from the app:// handler).
import type { Session, WebContents } from "electron";
import { buildCsp } from "./csp.ts";
import { isAllowedExternalUrl } from "./external-links.ts";
import { isAppUrl, type SenderPolicy } from "./sender-guard.ts";

export function hardenSession(session: Session, policy: SenderPolicy): void {
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_req, callback) => callback({}));
  if (policy.devOrigin !== undefined) {
    const csp = buildCsp({ dev: true, devOrigin: policy.devOrigin });
    session.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      if (details.url.startsWith(policy.devOrigin ?? "\0")) headers["Content-Security-Policy"] = [csp];
      callback({ responseHeaders: headers });
    });
  }
}

export function hardenWebContents(
  contents: WebContents,
  policy: SenderPolicy,
  openExternal: (url: string) => void,
): void {
  contents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url, policy)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isAppUrl(url, policy)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) openExternal(url);
    return { action: "deny" };
  });
}
