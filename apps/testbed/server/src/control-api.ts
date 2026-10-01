// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Control API on 127.0.0.1:4401 for the harness: reset, seed, clock, oracles, mail.
// Never linked from the app; the driver blocks the agent's browser from reaching it.
import { ClockRequest, getTask, ResetRequest, SESSION_COOKIE, SessionRequest } from "@ghosthand/testbed-kit";
import { Hono } from "hono";
import { auditMiddleware, type Env } from "./audit-middleware.ts";
import type { Testbed } from "./testbed.ts";

async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createControlApi(testbed: Testbed): Hono<Env> {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("user", undefined);
    await next();
  });
  app.use("*", auditMiddleware(testbed, "control"));

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/reset", async (c) => {
    const parsed = ResetRequest.safeParse(await body(c.req.raw));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    testbed.reset(parsed.data);
    c.set("audit", { action: "control.reset", detail: { seed: testbed.seed, variant: testbed.variant } });
    return c.json({ seed: testbed.seed, variant: testbed.variant, resetId: testbed.resetId });
  });

  app.post("/seed/:name", (c) => {
    const name = c.req.param("name");
    const applied = testbed.applySeed(name);
    c.set("audit", { action: "control.seed", detail: { name, applied } });
    if (!applied) return c.json({ error: `unknown seed ${name}` }, 404);
    return c.json({ name, applied });
  });

  app.post("/clock", async (c) => {
    const parsed = ClockRequest.safeParse(await body(c.req.raw));
    if (!parsed.success) return c.json({ error: "body must be {iso: <ISO 8601 datetime>}" }, 400);
    testbed.clock.set(parsed.data.iso);
    c.set("audit", { action: "control.clock", detail: { iso: testbed.clock.now() } });
    return c.json({ now: testbed.clock.now() });
  });

  app.post("/session", async (c) => {
    const parsed = SessionRequest.safeParse(await body(c.req.raw));
    const user = parsed.success ? testbed.userByEmail(parsed.data.email) : undefined;
    if (!user) return c.json({ error: "unknown user" }, 404);
    const value = testbed.createSession(user.id);
    c.set("audit", { action: "control.session", detail: { email: user.email } });
    return c.json({ cookie: { name: SESSION_COOKIE, value } });
  });

  app.get("/oracle/:task", (c) => {
    const task = getTask(c.req.param("task"));
    if (!task) return c.json({ error: `unknown task ${c.req.param("task")}` }, 404);
    const answer = c.req.query("answer");
    return c.json(task.oracle(testbed.snapshot(), answer === undefined ? {} : { answer }));
  });

  app.get("/mail", (c) => c.json({ messages: testbed.mail() }));
  app.get("/state", (c) => c.json(testbed.snapshot()));
  app.get("/dump", (c) => c.json(testbed.dump()));

  app.notFound((c) => c.json({ error: "not found" }, 404));
  return app;
}
