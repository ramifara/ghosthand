// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// TestIdP: a fake OAuth identity provider on its own origin (127.0.0.1:IDP_PORT) for the L5 SSO task.
// Server-rendered HTML: sign-in form, consent screen, then a redirect back to the app with a code.
// It has its own account directory and passwords, separate from the testbed's.
import { ALICE_EMAIL, fixtureSecrets, IDP_CLIENT_ID, IDP_NAME } from "@ghosthand/testbed-kit";
import { Hono } from "hono";
import { auditMiddleware, type Env } from "./audit-middleware.ts";
import { createToken, liveToken, setTokenUser, useToken } from "./auth-tokens.ts";
import { ssoRedirectUri } from "./sso-api.ts";
import type { Testbed } from "./testbed.ts";

/** TestIdP accounts: email → password. Only Alice has one. */
const IDP_ACCOUNTS: Record<string, string> = { [ALICE_EMAIL]: fixtureSecrets.TESTBED_IDP_PASSWORD };

export const IDP_MESSAGES = {
  badCredentials: "Incorrect email or password.",
  badRequest: "This sign-in request is invalid or has expired. Go back to the app and try again.",
} as const;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${IDP_NAME}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #eef1f6; color: #17202c; margin: 0; }
  header { background: #23345c; color: #fff; padding: 10px 20px; font-weight: 600; }
  main { max-width: 380px; margin: 48px auto; background: #fff; border-radius: 10px; padding: 24px;
    box-shadow: 0 2px 10px rgba(0,0,0,.08); }
  h1 { font-size: 20px; margin: 0 0 12px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 4px; }
  input[type=email], input[type=password] { width: 100%; box-sizing: border-box; padding: 8px;
    border: 1px solid #9aa6b8; border-radius: 6px; font-size: 14px; }
  button { margin-top: 16px; padding: 8px 14px; border-radius: 6px; border: 1px solid #23345c;
    background: #23345c; color: #fff; font-size: 14px; cursor: pointer; }
  button.secondary { background: #fff; color: #23345c; }
  .error { background: #fde8e8; color: #8a1c1c; border: 1px solid #e3a5a5; padding: 8px; border-radius: 6px; }
  ul { padding-left: 20px; }
</style>
</head>
<body>
<header>${IDP_NAME}</header>
<main>${body}</main>
</body>
</html>`;
}

function signInPage(request: string, client: string, error?: string, email = ""): string {
  return page(
    "Sign in",
    `<h1>Sign in to ${IDP_NAME}</h1>
<p>to continue to <strong>${escapeHtml(client)}</strong></p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/login">
  <input type="hidden" name="request" value="${escapeHtml(request)}">
  <label for="idp-email">Email</label>
  <input id="idp-email" name="email" type="email" autocomplete="username" value="${escapeHtml(email)}">
  <label for="idp-password">Password</label>
  <input id="idp-password" name="password" type="password" autocomplete="current-password">
  <button type="submit">Sign in</button>
</form>`,
  );
}

function consentPage(request: string, client: string, email: string): string {
  return page(
    "Allow access",
    `<h1>Allow ${escapeHtml(client)} to access your account?</h1>
<p>Signed in to ${IDP_NAME} as <strong>${escapeHtml(email)}</strong>.</p>
<p>${escapeHtml(client)} will be able to:</p>
<ul><li>See your name and email address</li></ul>
<form method="post" action="/consent">
  <input type="hidden" name="request" value="${escapeHtml(request)}">
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</form>`,
  );
}

const CLIENT_NAME = "GhostHand testbed";

function field(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v : "";
}

export function createIdpApp(testbed: Testbed): Hono<Env> {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("user", undefined);
    await next();
  });
  app.use("*", auditMiddleware(testbed, "anonymous"));

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/authorize", (c) => {
    const redirectUri = c.req.query("redirect_uri") ?? "";
    const state = c.req.query("state") ?? "";
    if (c.req.query("client_id") !== IDP_CLIENT_ID || redirectUri !== ssoRedirectUri() || !state) {
      return c.html(page("Error", `<p class="error" role="alert">${IDP_MESSAGES.badRequest}</p>`), 400);
    }
    const request = createToken(testbed.db, {
      kind: "idp_request",
      now: testbed.clock.now(),
      data: { redirectUri, state },
    });
    return c.html(signInPage(request, CLIENT_NAME));
  });

  app.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const request = liveToken(testbed.db, field(body, "request"), "idp_request");
    if (!request) {
      c.set("audit", { action: "idp.login", detail: { reason: "bad_request" } });
      return c.html(page("Error", `<p class="error" role="alert">${IDP_MESSAGES.badRequest}</p>`), 400);
    }
    const email = field(body, "email").trim().toLowerCase();
    const expected = IDP_ACCOUNTS[email];
    const user = expected !== undefined ? testbed.userByEmail(email) : undefined;
    if (expected === undefined || !user || field(body, "password") !== expected) {
      c.set("audit", { action: "idp.login", detail: { email, reason: "bad_credentials" } });
      return c.html(signInPage(request.token, CLIENT_NAME, IDP_MESSAGES.badCredentials, email), 401);
    }
    setTokenUser(testbed.db, request.token, user.id);
    c.set("audit", { action: "idp.login", actor: email, detail: { email } });
    return c.html(consentPage(request.token, CLIENT_NAME, email));
  });

  app.post("/consent", async (c) => {
    const body = await c.req.parseBody();
    const request = liveToken(testbed.db, field(body, "request"), "idp_request");
    const user = request?.userId ? testbed.users().find((u) => u.id === request.userId) : undefined;
    const redirectUri = request?.data.redirectUri;
    const state = request?.data.state;
    if (!request || !user || !redirectUri || !state) {
      c.set("audit", { action: "idp.consent", detail: { reason: "bad_request" } });
      return c.html(page("Error", `<p class="error" role="alert">${IDP_MESSAGES.badRequest}</p>`), 400);
    }
    useToken(testbed.db, request.token, testbed.clock.now());
    const back = new URL(redirectUri);
    back.searchParams.set("state", state);
    const decision = field(body, "decision") === "allow" ? "allow" : "deny";
    if (decision === "allow") {
      const code = createToken(testbed.db, {
        kind: "idp_code",
        userId: user.id,
        now: testbed.clock.now(),
        data: { clientId: IDP_CLIENT_ID, redirectUri },
      });
      back.searchParams.set("code", code);
    } else {
      back.searchParams.set("error", "access_denied");
    }
    c.set("audit", { action: "idp.consent", actor: user.email, detail: { decision } });
    return c.redirect(back.href, 302);
  });

  app.notFound((c) => c.html(page("Not found", "<p>Not found.</p>"), 404));
  return app;
}
