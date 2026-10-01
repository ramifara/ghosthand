// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L3 app routes: per-user settings (tabs, slider, accordion actions) and the rich-text bio.
import {
  GeneralSettingsInput,
  NotificationSettingsInput,
  RICH_TEXT_MAX,
  SETTINGS_MESSAGES,
  sanitizeRichText,
} from "@ghosthand/testbed-kit";
import type { Context, Hono } from "hono";
import type { Env } from "./audit-middleware.ts";
import { readJson } from "./read-json.ts";
import type { Testbed } from "./testbed.ts";

function unauthenticated(c: Context<Env>, action: string) {
  c.set("audit", { action, detail: { reason: "unauthenticated" } });
  return c.json({ error: "Sign in to change your settings." }, 401);
}

/** A fake, non-secret key preview. The full key never exists. */
function apiKeyPreview(userId: number, revoked: boolean): string {
  return revoked ? "" : `gh_test_••••${(4096 + userId * 37).toString(16)}`;
}

export function registerSettingsRoutes(app: Hono<Env>, testbed: Testbed): void {
  const respond = (c: Context<Env>, userId: number, message?: string) => {
    const settings = testbed.settingsFor(userId);
    if (!settings) return c.json({ error: "Settings not found." }, 404);
    return c.json({
      settings,
      apiKeyPreview: apiKeyPreview(userId, settings.apiKeyRevoked),
      ...(message === undefined ? {} : { message }),
    });
  };

  app.get("/settings", (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Sign in to see your settings." }, 401);
    return respond(c, user.id);
  });

  app.put("/settings/general", async (c) => {
    const action = "settings.general";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const parsed = GeneralSettingsInput.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      c.set("audit", { action, detail: { reason: "invalid" } });
      return c.json({ error: "Those settings aren't valid." }, 400);
    }
    testbed.db
      .query("update user_settings set compact_tables = $v where user_id = $id")
      .run({ v: parsed.data.compactTables ? 1 : 0, id: user.id });
    c.set("audit", { action, detail: parsed.data });
    return respond(c, user.id, SETTINGS_MESSAGES.general);
  });

  app.put("/settings/notifications", async (c) => {
    const action = "settings.notifications";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const parsed = NotificationSettingsInput.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      c.set("audit", { action, detail: { reason: "invalid" } });
      return c.json({ error: "Those settings aren't valid." }, 400);
    }
    testbed.db
      .query("update user_settings set email_limit = $limit, digest = $digest where user_id = $id")
      .run({ limit: parsed.data.emailLimit, digest: parsed.data.digest, id: user.id });
    c.set("audit", { action, detail: parsed.data });
    return respond(c, user.id, SETTINGS_MESSAGES.notifications);
  });

  app.post("/settings/webhook-secret/rotate", (c) => {
    const action = "settings.webhook_rotate";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    testbed.db
      .query(
        "update user_settings set webhook_secret_version = webhook_secret_version + 1 where user_id = $id",
      )
      .run({ id: user.id });
    c.set("audit", { action, detail: { version: testbed.settingsFor(user.id)?.webhookSecretVersion } });
    return respond(c, user.id, SETTINGS_MESSAGES.webhookRotated);
  });

  app.post("/settings/api-key/revoke", (c) => {
    const action = "settings.api_key_revoke";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    if (testbed.settingsFor(user.id)?.apiKeyRevoked) {
      c.set("audit", { action, detail: { reason: "already_revoked" } });
      return c.json({ error: "The API key is already revoked." }, 409);
    }
    testbed.db.query("update user_settings set api_key_revoked = 1 where user_id = $id").run({ id: user.id });
    c.set("audit", { action, detail: {} });
    return respond(c, user.id, SETTINGS_MESSAGES.apiKeyRevoked);
  });

  app.get("/bio", (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Sign in to edit your bio." }, 401);
    const html = testbed.bios().find((b) => b.userId === user.id)?.html ?? "";
    return c.json({ html });
  });

  app.put("/bio", async (c) => {
    const action = "bio.update";
    const user = c.get("user");
    if (!user) return unauthenticated(c, action);
    const body = await readJson(c.req.raw);
    const raw = typeof body.html === "string" ? body.html : undefined;
    const html = raw === undefined ? undefined : sanitizeRichText(raw);
    if (html === undefined || html.length > RICH_TEXT_MAX) {
      c.set("audit", { action, detail: { reason: "invalid" } });
      return c.json({ error: `Your bio can be at most ${RICH_TEXT_MAX} characters of formatted text.` }, 400);
    }
    testbed.db
      .query(
        "insert into bios (user_id, html) values ($id, $html) on conflict(user_id) do update set html = excluded.html",
      )
      .run({ id: user.id, html });
    c.set("audit", { action, detail: { length: html.length } });
    return c.json({ html, message: SETTINGS_MESSAGES.bioSaved });
  });
}
