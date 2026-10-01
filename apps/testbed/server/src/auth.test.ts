// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { beforeEach, describe, expect, test } from "bun:test";
import {
  ALICE_EMAIL,
  AUTH_MAIL_SUBJECTS,
  AUTH_MESSAGES,
  AUTH_SEEDS,
  EMAIL_CODE_COOKIE,
  fixtureSecrets,
  getTask,
  L5_STATUS_MESSAGE,
  MFA_COOKIE,
  type OracleResult,
  SESSION_COOKIE,
  SSO_STATE_COOKIE,
} from "@ghosthand/testbed-kit";
import { Secret, TOTP } from "otpauth";
import { createAppApi } from "./app-api.ts";
import { verifyTotp } from "./auth-api.ts";
import { createIdpApp } from "./idp-server.ts";
import { ssoRedirectUri } from "./sso-api.ts";
import { Testbed } from "./testbed.ts";

let testbed: Testbed;
let app: ReturnType<typeof createAppApi>;

beforeEach(() => {
  testbed = new Testbed();
  app = createAppApi(testbed);
});

/** A tiny cookie jar: enough for one browser talking to the app. */
class Jar {
  private cookies = new Map<string, string>();
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  take(res: Response): Response {
    for (const line of res.headers.getSetCookie()) {
      const [pair = "", ...attrs] = line.split(";");
      const [name = "", value = ""] = pair.split("=");
      const expired = attrs.some((a) => /max-age=0/i.test(a) || /expires=thu, 01 jan 1970/i.test(a));
      if (expired || value === "") this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value.trim());
    }
    return res;
  }
  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }
  has(name: string): boolean {
    return this.cookies.has(name);
  }
}

async function call(jar: Jar, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { cookie: jar.header() };
  if (body !== undefined) headers["content-type"] = "application/json";
  return jar.take(
    await app.request(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

function oracle(taskId: string): OracleResult {
  const task = getTask(taskId);
  if (!task) throw new Error(`no task ${taskId}`);
  return task.oracle(testbed.snapshot(), {});
}

function prepare(taskId: string): void {
  const task = getTask(taskId);
  if (!task) throw new Error(`no task ${taskId}`);
  testbed.reset({ seed: task.setup.seed, variant: task.setup.variant });
  for (const name of task.setup.seeds) expect(testbed.applySeed(name)).toBe(true);
}

/** The relative link with `label` in the newest mail to Alice with `subject`. */
function mailLink(subject: string): string {
  const mail = testbed.mail(ALICE_EMAIL).findLast((m) => m.subject === subject);
  const match = /\]\((\/[^)\s]+)\)/.exec(mail?.body ?? "");
  if (!match?.[1]) throw new Error(`no link in mail "${subject}"`);
  return match[1];
}

function totpNow(offsetSteps = 0): string {
  const totp = new TOTP({ secret: Secret.fromBase32(fixtureSecrets.TESTBED_TOTP) });
  return totp.generate({ timestamp: Date.now() + offsetSteps * 30_000 });
}

describe("TOTP two-step sign-in", () => {
  test("verifies against real time with one step of drift either way", () => {
    const secret = fixtureSecrets.TESTBED_TOTP;
    expect(verifyTotp(secret, totpNow())).toBe(true);
    expect(verifyTotp(secret, totpNow(-1))).toBe(true);
    expect(verifyTotp(secret, totpNow(3))).toBe(false);
    expect(verifyTotp(secret, "12345")).toBe(false);
  });

  test("a correct password opens a challenge, a code finishes it, and the oracle passes", async () => {
    prepare("l5-totp-login");
    const jar = new Jar();
    const login = await call(jar, "POST", "/api/login", {
      email: ALICE_EMAIL,
      password: fixtureSecrets.TESTBED_PASSWORD,
    });
    expect(await login.json()).toEqual({ mfa: "totp", message: AUTH_MESSAGES.totpPrompt });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(jar.has(MFA_COOKIE)).toBe(true);
    expect(testbed.snapshot().sessions).toEqual([]);
    expect(oracle("l5-totp-login").pass).toBe(false);

    const wrong = await call(jar, "POST", "/api/auth/totp", {
      code: "000000" === totpNow() ? "111111" : "000000",
    });
    expect(wrong.status).toBe(400);
    const ok = await call(jar, "POST", "/api/auth/totp", { code: totpNow() });
    expect(ok.status).toBe(200);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(oracle("l5-totp-login")).toMatchObject({ pass: true });

    // The challenge is single-use.
    const again = await call(jar, "POST", "/api/auth/totp", { code: totpNow() });
    expect(again.status).toBe(401);
  });

  test("users without TOTP still sign in with just the password", async () => {
    const jar = new Jar();
    const res = await call(jar, "POST", "/api/login", {
      email: ALICE_EMAIL,
      password: fixtureSecrets.TESTBED_PASSWORD,
    });
    expect(((await res.json()) as { user: { email: string } }).user.email).toBe(ALICE_EMAIL);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
  });
});

describe("magic link", () => {
  test("request, read the mail, consume once", async () => {
    prepare("l5-magic-link");
    const jar = new Jar();
    const unknown = await call(jar, "POST", "/api/auth/magic-link", { email: "nobody@testbed.local" });
    expect(((await unknown.json()) as { message: string }).message).toBe(AUTH_MESSAGES.linkSent);
    expect(testbed.mail()).toEqual([]);

    await call(jar, "POST", "/api/auth/magic-link", { email: ALICE_EMAIL });
    const link = mailLink(AUTH_MAIL_SUBJECTS.magicLink);
    expect(link).toStartWith("/login/magic?token=");
    const token = new URL(link, "http://x").searchParams.get("token") ?? "";
    const peek = await call(jar, "GET", `/api/auth/magic-link?token=${token}`);
    expect(await peek.json()).toEqual({ email: ALICE_EMAIL });
    expect(oracle("l5-magic-link").pass).toBe(false);

    const consumed = await call(jar, "POST", "/api/auth/magic-link/consume", { token });
    expect(consumed.status).toBe(200);
    expect(oracle("l5-magic-link")).toMatchObject({ pass: true });
    const reuse = await call(new Jar(), "POST", "/api/auth/magic-link/consume", { token });
    expect(reuse.status).toBe(400);
  });
});

describe("email code", () => {
  test("the code only works in the browser that asked for it", async () => {
    prepare("l5-email-code");
    const jar = new Jar();
    await call(jar, "POST", "/api/auth/email-code", { email: ALICE_EMAIL });
    expect(jar.has(EMAIL_CODE_COOKIE)).toBe(true);
    const link = mailLink(AUTH_MAIL_SUBJECTS.emailCode);
    const code = new URL(link, "http://x").searchParams.get("code") ?? "";
    expect(code).toMatch(/^\d{6}$/);
    expect(await (await call(jar, "GET", "/api/auth/email-code")).json()).toEqual({ email: ALICE_EMAIL });

    const elsewhere = await call(new Jar(), "POST", "/api/auth/email-code/verify", { code });
    expect(elsewhere.status).toBe(400);
    const wrong = await call(jar, "POST", "/api/auth/email-code/verify", {
      code: code === "000000" ? "111111" : "000000",
    });
    expect(wrong.status).toBe(400);
    expect(oracle("l5-email-code").pass).toBe(false);

    const ok = await call(jar, "POST", "/api/auth/email-code/verify", { code });
    expect(ok.status).toBe(200);
    expect(oracle("l5-email-code")).toMatchObject({ pass: true });
  });
});

describe("password reset", () => {
  test("reset by mail, old password stops working, new one signs in", async () => {
    prepare("l5-password-reset");
    const jar = new Jar();
    await call(jar, "POST", "/api/auth/password-reset", { email: ALICE_EMAIL });
    const token =
      new URL(mailLink(AUTH_MAIL_SUBJECTS.passwordReset), "http://x").searchParams.get("token") ?? "";
    expect(await (await call(jar, "GET", `/api/auth/password-reset?token=${token}`)).json()).toEqual({
      email: ALICE_EMAIL,
    });
    const next = fixtureSecrets.TESTBED_NEW_PASSWORD;
    const mismatch = await call(jar, "POST", "/api/auth/password-reset/complete", {
      token,
      password: next,
      confirm: `${next}x`,
    });
    expect(mismatch.status).toBe(400);
    const done = await call(jar, "POST", "/api/auth/password-reset/complete", {
      token,
      password: next,
      confirm: next,
    });
    expect(((await done.json()) as { message: string }).message).toBe(AUTH_MESSAGES.passwordReset);
    expect(oracle("l5-password-reset").pass).toBe(false);

    const old = await call(jar, "POST", "/api/login", {
      email: ALICE_EMAIL,
      password: fixtureSecrets.TESTBED_PASSWORD,
    });
    expect(old.status).toBe(401);
    const fresh = await call(jar, "POST", "/api/login", { email: ALICE_EMAIL, password: next });
    expect(fresh.status).toBe(200);
    expect(oracle("l5-password-reset")).toMatchObject({ pass: true });
  });
});

describe("session expiry", () => {
  test("the first save expires the session; after signing in again the save sticks", async () => {
    prepare("l5-session-expiry");
    const jar = new Jar();
    const session = testbed.createSession(testbed.userByEmail(ALICE_EMAIL)?.id ?? -1);
    jar.set(SESSION_COOKIE, session);
    expect(await (await call(jar, "GET", "/api/status")).json()).toEqual({ message: "" });

    const first = await call(jar, "PUT", "/api/status", { message: L5_STATUS_MESSAGE });
    expect(first.status).toBe(401);
    expect(((await first.json()) as { error: string }).error).toBe(AUTH_MESSAGES.sessionExpired);
    expect(testbed.snapshot().sessions).toEqual([]);
    expect(oracle("l5-session-expiry").pass).toBe(false);

    await call(jar, "POST", "/api/login", { email: ALICE_EMAIL, password: fixtureSecrets.TESTBED_PASSWORD });
    const second = await call(jar, "PUT", "/api/status", { message: L5_STATUS_MESSAGE });
    expect(second.status).toBe(200);
    expect(oracle("l5-session-expiry")).toMatchObject({ pass: true });

    // Saving twice fails the "saved once" check.
    await call(jar, "PUT", "/api/status", { message: L5_STATUS_MESSAGE });
    expect(oracle("l5-session-expiry").checks.savedOnceAfterSignIn).toBe(false);
  });

  test("without the seed the status saves normally", async () => {
    expect(testbed.applySeed(AUTH_SEEDS.aliceTotp)).toBe(true);
    const jar = new Jar();
    const session = testbed.createSession(testbed.userByEmail(ALICE_EMAIL)?.id ?? -1);
    jar.set(SESSION_COOKIE, session);
    expect((await call(jar, "PUT", "/api/status", { message: "Hi" })).status).toBe(200);
  });
});

describe("SSO through TestIdP", () => {
  async function authorize(jar: Jar): Promise<{ idp: ReturnType<typeof createIdpApp>; request: string }> {
    const start = await call(jar, "GET", "/api/sso/start");
    expect(start.status).toBe(302);
    expect(jar.has(SSO_STATE_COOKIE)).toBe(true);
    const location = new URL(start.headers.get("location") ?? "");
    expect(location.searchParams.get("redirect_uri")).toBe(ssoRedirectUri());
    const idp = createIdpApp(testbed);
    const form = await idp.request(`${location.pathname}${location.search}`);
    const html = await form.text();
    expect(html).toContain('<label for="idp-email">Email</label>');
    const request = /name="request" value="([^"]+)"/.exec(html)?.[1] ?? "";
    return { idp, request };
  }

  function post(idp: ReturnType<typeof createIdpApp>, path: string, fields: Record<string, string>) {
    return idp.request(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  }

  test("sign in at the IdP, allow, and come back signed in", async () => {
    prepare("l5-sso-idp");
    const jar = new Jar();
    const { idp, request } = await authorize(jar);
    const bad = await post(idp, "/login", {
      request,
      email: ALICE_EMAIL,
      password: fixtureSecrets.TESTBED_PASSWORD,
    });
    expect(bad.status).toBe(401);
    const good = await post(idp, "/login", {
      request,
      email: ALICE_EMAIL,
      password: fixtureSecrets.TESTBED_IDP_PASSWORD,
    });
    expect(await good.text()).toContain("Allow");
    const consent = await post(idp, "/consent", { request, decision: "allow" });
    expect(consent.status).toBe(302);
    const back = new URL(consent.headers.get("location") ?? "");
    expect(`${back.origin}${back.pathname}`).toBe(ssoRedirectUri());
    expect(oracle("l5-sso-idp").pass).toBe(false);

    const callback = await call(jar, "GET", `${back.pathname}${back.search}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/");
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(oracle("l5-sso-idp")).toMatchObject({ pass: true });

    // The code is single-use.
    const replay = await call(new Jar(), "GET", `${back.pathname}${back.search}`);
    expect(replay.headers.get("location")).toBe("/login?sso=failed");
  });

  test("deny sends the user back to the sign-in page without a session", async () => {
    const jar = new Jar();
    const { idp, request } = await authorize(jar);
    await post(idp, "/login", { request, email: ALICE_EMAIL, password: fixtureSecrets.TESTBED_IDP_PASSWORD });
    const consent = await post(idp, "/consent", { request, decision: "deny" });
    const back = new URL(consent.headers.get("location") ?? "");
    const callback = await call(jar, "GET", `${back.pathname}${back.search}`);
    expect(callback.headers.get("location")).toBe("/login?sso=denied");
    expect(testbed.snapshot().sessions).toEqual([]);
  });

  test("rejects a foreign redirect_uri", async () => {
    const idp = createIdpApp(testbed);
    const res = await idp.request(
      "/authorize?client_id=ghosthand-testbed&redirect_uri=https://evil.example/cb&state=x",
    );
    expect(res.status).toBe(400);
  });
});
