// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Main only answers IPC from the app's own top-level frame: `app://ghosthand` in production, the
// electron-vite dev server origin in development. Anything else (a stray iframe, a navigated page,
// devtools on a different origin) is refused before the payload is even parsed.

export const APP_SCHEME = "app";
export const APP_HOST = "ghosthand";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

export interface SenderInfo {
  /** `event.senderFrame?.url`; undefined when the frame is gone. */
  url: string | undefined;
  /** True for the window's top-level frame. */
  isMainFrame: boolean;
}

export interface SenderPolicy {
  /** The dev server origin (`http://127.0.0.1:5173`) when running `electron-vite dev`. */
  devOrigin?: string | undefined;
}

function originOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    // `app://ghosthand/...` is a standard scheme, so URL gives a real origin for it.
    return u.protocol === `${APP_SCHEME}:` ? `${APP_SCHEME}://${u.host}` : u.origin;
  } catch {
    return undefined;
  }
}

export function isTrustedSender(sender: SenderInfo, policy: SenderPolicy = {}): boolean {
  if (!sender.isMainFrame || !sender.url) return false;
  const origin = originOf(sender.url);
  if (origin === undefined) return false;
  if (origin === APP_ORIGIN) return true;
  if (policy.devOrigin !== undefined && origin === originOf(policy.devOrigin)) {
    // Dev only ever runs on loopback.
    const host = new URL(sender.url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  }
  return false;
}

/** Same rule for navigation: the window may only show the app itself. */
export function isAppUrl(url: string, policy: SenderPolicy = {}): boolean {
  return isTrustedSender({ url, isMainFrame: true }, policy);
}
