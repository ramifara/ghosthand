// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L5 app routes: TOTP two-step sign-in, magic links, email codes, password reset, and the status message
// whose save trips the session-expiry trap. Mail goes to the in-app mail table (read at /mailbox).
import {
  AUTH_MAIL_SUBJECTS,
  AUTH_MESSAGES,
  EMAIL_CODE_COOKIE,
  MFA_COOKIE,
  SESSION_COOKIE,
  STATUS_MAX,
  StatusInput,
  type UserRow,
} from "@ghosthand/testbed-kit";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Secret, TOTP } from "otpauth";
import type { Env } from "./audit-middleware.ts";
import { SESSION_EXPIRY_FACT } from "./auth-seeds.ts";
import {
  countAttempt,
  createToken,
  fact,
  liveToken,
  setFact,
  sixDigitCode,
  useToken,
} from "./auth-tokens.ts";
import { hashPassword } from "./password.ts";
import { readJson } from "./read-json.ts";
import type { Testbed } from "./testbed.ts";

const COOKIE_OPTS = { httpOnly: true, sameSite: "Lax", path: "/" } as const;

function emailOf(body: Record<string, unknown>): string {
  return typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
}

function stringOf(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v.trim() : "";
}

/** Starts a session for `userId`, sets the cookie and returns the public user. */
export function signIn(c: Context<Env>, testbed: Testbed, userId: number): UserRow | undefined {
  const token = testbed.createSession(userId);
  setCookie(c, SESSION_COOKIE, token, COOKIE_OPTS);
  return testbed.userBySession(token);
}

function totpSecretOf(testbed: Testbed, userId: number): string | undefined {
  return (
    testbed.db
      .query<{ secret: string }, { userId: number }>("select secret from user_totp where user_id = $userId")
      .get({ userId })?.secret ?? undefined
  );
}

/** RFC 6238 check against real wall-clock time (the testbed clock is frozen), one step either side. */
export function verifyTotp(secret: string, code: string, timestamp: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const totp = new TOTP({ secret: Secret.fromBase32(secret), algorithm: "SHA1", digits: 6, period: 30 });
  return totp.validate({ token: code, window: 1, timestamp }) !== null;
}

/**
 * Called by `POST /api/login` after a correct password. For a user with TOTP it opens a two-step challenge
 * instead of a session and returns the response; otherwise undefined.
 */
export function startTotpChallenge(c: Context<Env>, testbed: Testbed, user: UserRow): Response | undefined {
  if (totpSecretOf(testbed, user.id) === undefined) return undefined;
  const token = createToken(testbed.db, { kind: "mfa", userId: user.id, now: testbed.clock.now() });
  setCookie(c, MFA_COOKIE, token, COOKIE_OPTS);
  c.set("audit", { action: "auth.login", actor: user.email, detail: { email: user.email, mfa: "totp" } });
  return c.json({ mfa: "totp" as const, message: AUTH_MESSAGES.totpPrompt });
}

export function registerAuthRoutes(app: Hono<Env>, testbed: Testbed): void {
  const db = () => testbed.db;
  const now = () => testbed.clock.now();
  const userById = (id: number | null) =>
    id === null ? undefined : testbed.users().find((u) => u.id === id);

  // The dev mailbox (like Mailpit's UI): anyone on the testbed origin can read any address's mail without a
  // session, which is how the agent reads sign-in links and codes before it is signed in.
  app.get("/mailbox", (c) => {
    const address = (c.req.query("address") ?? "").trim().toLowerCase();
    if (!address) return c.json({ error: "Enter a mailbox address." }, 400);
    return c.json({ messages: testbed.mail(address) });
  });

  app.post("/auth/totp", async (c) => {
    const action = "auth.totp";
    const challenge = liveToken(db(), getCookie(c, MFA_COOKIE), "mfa");
    const user = challenge ? userById(challenge.userId) : undefined;
    const secret = user ? totpSecretOf(testbed, user.id) : undefined;
    if (!challenge || !user || secret === undefined) {
      c.set("audit", { action, detail: { reason: "no_challenge" } });
      return c.json({ error: AUTH_MESSAGES.totpExpired }, 401);
    }
    const code = stringOf(await readJson(c.req.raw), "code").replace(/\s+/g, "");
    if (!verifyTotp(secret, code)) {
      countAttempt(db(), challenge.token);
      c.set("audit", { action, actor: user.email, detail: { reason: "bad_code" } });
      return c.json({ error: AUTH_MESSAGES.totpInvalid }, 400);
    }
    useToken(db(), challenge.token, now());
    deleteCookie(c, MFA_COOKIE, { path: "/" });
    const signedIn = signIn(c, testbed, user.id);
    c.set("audit", { action, actor: user.email, detail: { email: user.email } });
    return c.json({ user: signedIn });
  });

  app.post("/auth/magic-link", async (c) => {
    const action = "auth.magic_link_request";
    const email = emailOf(await readJson(c.req.raw));
    if (!email) {
      c.set("audit", { action, detail: { reason: "missing_email" } });
      return c.json({ error: "Enter your email address." }, 400);
    }
    const user = testbed.userByEmail(email);
    if (user) {
      const token = createToken(db(), { kind: "magic_link", userId: user.id, now: now() });
      testbed.sendMail(
        user.email,
        AUTH_MAIL_SUBJECTS.magicLink,
        `Someone asked to sign in to the testbed as ${user.email}. ` +
          `[Sign in to the testbed](/login/magic?token=${token}) The link works once. ` +
          "If this wasn't you, ignore this email.",
      );
    }
    c.set("audit", { action, detail: { email, known: user !== undefined } });
    return c.json({ message: AUTH_MESSAGES.linkSent });
  });

  app.get("/auth/magic-link", (c) => {
    const link = liveToken(db(), c.req.query("token"), "magic_link");
    const user = link ? userById(link.userId) : undefined;
    if (!user) return c.json({ error: AUTH_MESSAGES.linkInvalid }, 404);
    return c.json({ email: user.email });
  });

  app.post("/auth/magic-link/consume", async (c) => {
    const action = "auth.magic_link";
    const link = liveToken(db(), stringOf(await readJson(c.req.raw), "token"), "magic_link");
    const user = link ? userById(link.userId) : undefined;
    if (!link || !user) {
      c.set("audit", { action, detail: { reason: "invalid_link" } });
      return c.json({ error: AUTH_MESSAGES.linkInvalid }, 400);
    }
    useToken(db(), link.token, now());
    const signedIn = signIn(c, testbed, user.id);
    c.set("audit", { action, actor: user.email, detail: { email: user.email } });
    return c.json({ user: signedIn });
  });

  app.post("/auth/email-code", async (c) => {
    const action = "auth.email_code_request";
    const email = emailOf(await readJson(c.req.raw));
    if (!email) {
      c.set("audit", { action, detail: { reason: "missing_email" } });
      return c.json({ error: "Enter your email address." }, 400);
    }
    const user = testbed.userByEmail(email);
    if (user) {
      const code = sixDigitCode();
      const token = createToken(db(), { kind: "email_code", userId: user.id, code, now: now() });
      setCookie(c, EMAIL_CODE_COOKIE, token, COOKIE_OPTS);
      testbed.sendMail(
        user.email,
        AUTH_MAIL_SUBJECTS.emailCode,
        `Your testbed sign-in code is ${code}. It works once, in the browser where you asked for it. ` +
          `[Use code ${code}](/login/email-code?code=${code})`,
      );
    }
    c.set("audit", { action, detail: { email, known: user !== undefined } });
    return c.json({ message: AUTH_MESSAGES.codeSent });
  });

  app.get("/auth/email-code", (c) => {
    const pending = liveToken(db(), getCookie(c, EMAIL_CODE_COOKIE), "email_code");
    return c.json({ email: (pending ? userById(pending.userId)?.email : undefined) ?? null });
  });

  app.post("/auth/email-code/verify", async (c) => {
    const action = "auth.email_code";
    const pending = liveToken(db(), getCookie(c, EMAIL_CODE_COOKIE), "email_code");
    const user = pending ? userById(pending.userId) : undefined;
    const code = stringOf(await readJson(c.req.raw), "code").replace(/\s+/g, "");
    if (!pending || !user || pending.code !== code) {
      if (pending) countAttempt(db(), pending.token);
      c.set("audit", {
        action,
        ...(user ? { actor: user.email } : {}),
        detail: { reason: pending ? "bad_code" : "no_challenge" },
      });
      return c.json({ error: AUTH_MESSAGES.codeInvalid }, 400);
    }
    useToken(db(), pending.token, now());
    deleteCookie(c, EMAIL_CODE_COOKIE, { path: "/" });
    const signedIn = signIn(c, testbed, user.id);
    c.set("audit", { action, actor: user.email, detail: { email: user.email } });
    return c.json({ user: signedIn });
  });

  app.post("/auth/password-reset", async (c) => {
    const action = "auth.password_reset_request";
    const email = emailOf(await readJson(c.req.raw));
    if (!email) {
      c.set("audit", { action, detail: { reason: "missing_email" } });
      return c.json({ error: "Enter your email address." }, 400);
    }
    const user = testbed.userByEmail(email);
    if (user) {
      const token = createToken(db(), { kind: "password_reset", userId: user.id, now: now() });
      testbed.sendMail(
        user.email,
        AUTH_MAIL_SUBJECTS.passwordReset,
        `We got a request to reset the password for ${user.email}. ` +
          `[Choose a new password](/login/reset?token=${token}) The link works once. ` +
          "If you didn't ask for this, ignore this email.",
      );
    }
    c.set("audit", { action, detail: { email, known: user !== undefined } });
    return c.json({ message: AUTH_MESSAGES.resetSent });
  });

  app.get("/auth/password-reset", (c) => {
    const reset = liveToken(db(), c.req.query("token"), "password_reset");
    const user = reset ? userById(reset.userId) : undefined;
    if (!user) return c.json({ error: AUTH_MESSAGES.resetInvalid }, 404);
    return c.json({ email: user.email });
  });

  app.post("/auth/password-reset/complete", async (c) => {
    const action = "auth.password_reset";
    const body = await readJson(c.req.raw);
    const reset = liveToken(db(), stringOf(body, "token"), "password_reset");
    const full = reset ? userById(reset.userId) : undefined;
    const user = full ? testbed.userByEmail(full.email) : undefined;
    if (!reset || !user) {
      c.set("audit", { action, detail: { reason: "invalid_link" } });
      return c.json({ error: AUTH_MESSAGES.resetInvalid }, 400);
    }
    const password = typeof body.password === "string" ? body.password : "";
    const confirm = typeof body.confirm === "string" ? body.confirm : "";
    if (password.length < 8 || password !== confirm) {
      c.set("audit", { action, actor: user.email, detail: { reason: "invalid" } });
      return c.json({ error: AUTH_MESSAGES.resetMismatch }, 400);
    }
    db()
      .query("update users set password_hash = $hash where id = $id")
      .run({ hash: hashPassword(user.passwordSalt, password), id: user.id });
    useToken(db(), reset.token, now());
    // A reset signs the account out everywhere.
    db().query("delete from sessions where user_id = $id").run({ id: user.id });
    testbed.sendMail(
      user.email,
      AUTH_MAIL_SUBJECTS.passwordChanged,
      "Your testbed password was just changed. If this wasn't you, contact support.",
    );
    c.set("audit", { action, actor: user.email, detail: {} });
    return c.json({ message: AUTH_MESSAGES.passwordReset });
  });

  app.get("/status", (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Sign in to set your status." }, 401);
    const row = db()
      .query<{ message: string }, { id: number }>("select message from user_status where user_id = $id")
      .get({ id: user.id });
    return c.json({ message: row?.message ?? "" });
  });

  app.put("/status", async (c) => {
    const action = "status.update";
    const user = c.get("user");
    if (!user) {
      c.set("audit", { action, detail: { reason: "unauthenticated" } });
      return c.json({ error: "Sign in to set your status." }, 401);
    }
    // Session-expiry trap (seed `session-expiry`): the first save after the seed expires the session.
    if (fact(db(), SESSION_EXPIRY_FACT) === "armed") {
      setFact(db(), SESSION_EXPIRY_FACT, "fired");
      testbed.deleteSession(getCookie(c, SESSION_COOKIE) ?? "");
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      c.set("audit", { action, actor: user.email, detail: { reason: "session_expired" } });
      return c.json({ error: AUTH_MESSAGES.sessionExpired, code: "session_expired" }, 401);
    }
    const parsed = StatusInput.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      c.set("audit", { action, detail: { reason: "invalid" } });
      return c.json({ error: `A status can be at most ${STATUS_MAX} characters.` }, 400);
    }
    db()
      .query(
        `insert into user_status (user_id, message) values ($id, $message)
         on conflict(user_id) do update set message = excluded.message`,
      )
      .run({ id: user.id, message: parsed.data.message });
    c.set("audit", { action, detail: { length: parsed.data.message.length } });
    return c.json({ message: parsed.data.message, notice: AUTH_MESSAGES.statusSaved });
  });
}
