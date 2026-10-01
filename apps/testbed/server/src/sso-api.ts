// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// "Sign in with TestIdP": an authorization-code redirect to the fake IdP (idp-server.ts) and back. The
// IdP shares the Testbed, so the code exchange reads the same auth_tokens table instead of a back-channel.
import { APP_ORIGIN, IDP_CLIENT_ID, IDP_ORIGIN, SSO_STATE_COOKIE } from "@ghosthand/testbed-kit";
import type { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "./audit-middleware.ts";
import { signIn } from "./auth-api.ts";
import { createToken, liveToken, useToken } from "./auth-tokens.ts";
import type { Testbed } from "./testbed.ts";

export const SSO_CALLBACK_PATH = "/api/sso/callback";

export function ssoRedirectUri(): string {
  return `${APP_ORIGIN}${SSO_CALLBACK_PATH}`;
}

export function registerSsoRoutes(app: Hono<Env>, testbed: Testbed): void {
  const audit = (path: string, outcome: "ok" | "rejected", actor: string, detail: Record<string, unknown>) =>
    testbed.audit({ actor, method: "GET", path, action: "auth.sso", outcome, detail });

  app.get("/sso/start", (c) => {
    const state = createToken(testbed.db, { kind: "sso_state", now: testbed.clock.now() });
    setCookie(c, SSO_STATE_COOKIE, state, { httpOnly: true, sameSite: "Lax", path: "/" });
    const url = new URL("/authorize", IDP_ORIGIN);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", IDP_CLIENT_ID);
    url.searchParams.set("redirect_uri", ssoRedirectUri());
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    return c.redirect(url.href, 302);
  });

  app.get("/sso/callback", (c) => {
    const path = SSO_CALLBACK_PATH;
    const state = c.req.query("state") ?? "";
    const cookieState = getCookie(c, SSO_STATE_COOKIE);
    deleteCookie(c, SSO_STATE_COOKIE, { path: "/" });
    const stateRow = state === cookieState ? liveToken(testbed.db, state, "sso_state") : undefined;
    if (!stateRow) {
      audit(path, "rejected", "anonymous", { reason: "bad_state" });
      return c.redirect("/login?sso=failed", 302);
    }
    useToken(testbed.db, stateRow.token, testbed.clock.now());
    if (c.req.query("error")) {
      audit(path, "rejected", "anonymous", { reason: c.req.query("error") });
      return c.redirect("/login?sso=denied", 302);
    }
    const code = liveToken(testbed.db, c.req.query("code"), "idp_code");
    const user =
      code && code.data.clientId === IDP_CLIENT_ID && code.data.redirectUri === ssoRedirectUri()
        ? testbed.users().find((u) => u.id === code.userId)
        : undefined;
    if (!code || !user) {
      audit(path, "rejected", "anonymous", { reason: "bad_code" });
      return c.redirect("/login?sso=failed", 302);
    }
    useToken(testbed.db, code.token, testbed.clock.now());
    signIn(c, testbed, user.id);
    audit(path, "ok", user.email, { email: user.email, idp: "TestIdP" });
    return c.redirect("/", 302);
  });
}
