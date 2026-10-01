// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The app API the testbed web app calls under `/api`. This is what the agent's browser can reach.
import {
  HANDLE_TAKEN_MESSAGE,
  LOGIN_ERROR_MESSAGE,
  PROFILE_SAVED_MESSAGE,
  SESSION_COOKIE,
  validateProfile,
} from "@ghosthand/testbed-kit";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { registerAccountRoutes } from "./account-api.ts";
import { auditMiddleware, type Env } from "./audit-middleware.ts";
import { registerCatalogRoutes } from "./catalog-api.ts";
import { registerOrderRoutes } from "./orders-api.ts";
import { verifyPassword } from "./password.ts";
import { readJson } from "./read-json.ts";
import { registerSettingsRoutes } from "./settings-api.ts";
import type { Testbed } from "./testbed.ts";

export function createAppApi(testbed: Testbed): Hono<Env> {
  const app = new Hono<Env>().basePath("/api");

  app.use("*", async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    c.set("user", token ? testbed.userBySession(token) : undefined);
    await next();
  });
  app.use("*", auditMiddleware(testbed, "anonymous"));

  app.get("/config", (c) =>
    c.json({ variant: testbed.variant, resetId: testbed.resetId, now: testbed.clock.now() }),
  );

  app.get("/home", (c) => {
    const facts = testbed.facts();
    return c.json({
      buildCode: facts.build_code ?? "",
      releaseName: facts.release_name ?? "",
      openTickets: Number(facts.open_tickets ?? 0),
    });
  });

  app.get("/me", (c) => c.json({ user: c.get("user") ?? null }));

  app.post("/login", async (c) => {
    const body = await readJson(c.req.raw);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      c.set("audit", {
        action: "auth.login",
        actor: "anonymous",
        detail: { email, reason: "missing_fields", message: "Enter your email and password." },
      });
      return c.json({ error: "Enter your email and password." }, 400);
    }
    const user = testbed.userByEmail(email);
    if (!user || !verifyPassword(user.passwordSalt, user.passwordHash, password)) {
      c.set("audit", {
        action: "auth.login",
        actor: "anonymous",
        detail: { email, reason: "bad_credentials", message: LOGIN_ERROR_MESSAGE },
      });
      return c.json({ error: LOGIN_ERROR_MESSAGE }, 401);
    }
    const token = testbed.createSession(user.id);
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/" });
    c.set("audit", { action: "auth.login", actor: user.email, detail: { email: user.email } });
    const { passwordSalt: _s, passwordHash: _h, ...publicUser } = user;
    return c.json({ user: publicUser });
  });

  app.post("/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) testbed.deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    c.set("audit", { action: "auth.logout" });
    return c.json({ ok: true });
  });

  app.put("/profile", async (c) => {
    const user = c.get("user");
    if (!user) {
      c.set("audit", { action: "profile.update", detail: { reason: "unauthenticated" } });
      return c.json({ error: "Sign in to edit your profile." }, 401);
    }
    const result = validateProfile(await readJson(c.req.raw));
    if (!result.ok) {
      c.set("audit", { action: "profile.update", detail: { fieldErrors: result.fieldErrors } });
      return c.json({ error: "validation", fieldErrors: result.fieldErrors }, 400);
    }
    // Planted bug (variant bug=profile-title): the job title is silently dropped, the save still "succeeds".
    const next =
      testbed.variant.bug === "profile-title" ? { ...result.value, title: user.title } : result.value;
    const clash = testbed.db
      .query<{ id: number }, { handle: string; id: number }>(
        "select id from users where handle = $handle and id != $id",
      )
      .get({ handle: next.handle, id: user.id });
    if (clash) {
      const fieldErrors = { handle: HANDLE_TAKEN_MESSAGE };
      c.set("audit", { action: "profile.update", detail: { fieldErrors } });
      return c.json({ error: "validation", fieldErrors }, 409);
    }
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== user[k]);
    testbed.db
      .query(
        `update users set name = $name, handle = $handle, title = $title, website = $website, bio = $bio
         where id = $id`,
      )
      .run({ ...next, id: user.id });
    if (changed.length > 0) {
      testbed.sendMail(
        user.email,
        "Your profile was updated",
        `These fields changed: ${changed.join(", ")}. If this wasn't you, contact support.`,
      );
    }
    c.set("audit", { action: "profile.update", detail: { changed } });
    const updated = testbed.userBySession(getCookie(c, SESSION_COOKIE) ?? "");
    return c.json({ user: updated, message: PROFILE_SAVED_MESSAGE });
  });

  app.get("/mail", (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Sign in to read your mail." }, 401);
    return c.json({ messages: testbed.mail(user.email) });
  });

  registerOrderRoutes(app, testbed);
  registerSettingsRoutes(app, testbed);
  registerCatalogRoutes(app, testbed);
  registerAccountRoutes(app, testbed);

  app.notFound((c) => c.json({ error: "not found" }, 404));
  return app;
}
