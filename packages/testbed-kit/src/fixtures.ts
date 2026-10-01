// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Non-secret fixture data shared by the testbed server, tasks and e2e tests. Browser-safe.

export const ALICE_EMAIL = "alice@testbed.local";
export const BOB_EMAIL = "bob@testbed.local";
export const DEFAULT_SEED = 42;
/** The clock value every reset starts from unless the harness sets another. */
export const DEFAULT_NOW = "2026-03-02T09:00:00.000Z";
export const SESSION_COOKIE = "gh_session";
export const LOGIN_ERROR_MESSAGE = "Invalid email or password.";
export const HANDLE_TAKEN_MESSAGE = "That handle is already taken.";
export const PROFILE_SAVED_MESSAGE = "Profile saved.";
/**
 * Port offset for running a second testbed next to the default one (e.g. 100 → 4500/4501/4510/4502/4503).
 * Node reads `GHOSTHAND_TESTBED_PORT_OFFSET`; the browser derives it from the page's own port.
 */
export function testbedPortOffset(): number {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
    location?: { port?: string };
  };
  const raw = g.process?.env?.GHOSTHAND_TESTBED_PORT_OFFSET;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n < 1000 ? n : 0;
  }
  const port = Number(g.location?.port ?? "");
  // Only the app port itself (4400 + offset, offset a multiple of 100) is trusted in the browser.
  return Number.isInteger(port) && port >= 4400 && port < 5400 && (port - 4400) % 100 === 0 ? port - 4400 : 0;
}

const OFFSET = testbedPortOffset();
export const APP_PORT = 4400 + OFFSET;
export const CONTROL_PORT = 4401 + OFFSET;
/** Internal port of the Bun app API; Vite on :4400 proxies `/api` here. */
export const API_PORT = 4410 + OFFSET;
/** A second origin serving cross-origin iframe content (L4). */
export const FRAME_PORT = 4402 + OFFSET;
/** The fake identity provider for the SSO redirect task (L5). */
export const IDP_PORT = 4403 + OFFSET;
export const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
export const CONTROL_ORIGIN = `http://127.0.0.1:${CONTROL_PORT}`;
export const FRAME_ORIGIN = `http://127.0.0.1:${FRAME_PORT}`;
export const IDP_ORIGIN = `http://127.0.0.1:${IDP_PORT}`;
