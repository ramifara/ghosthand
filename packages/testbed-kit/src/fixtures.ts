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
export const APP_PORT = 4400;
export const CONTROL_PORT = 4401;
/** Internal port of the Bun app API; Vite on :4400 proxies `/api` here. */
export const API_PORT = 4410;
export const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
export const CONTROL_ORIGIN = `http://127.0.0.1:${CONTROL_PORT}`;
