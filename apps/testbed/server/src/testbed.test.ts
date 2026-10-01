// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { beforeEach, describe, expect, test } from "bun:test";
import {
  ALICE_EMAIL,
  fixtureSecrets,
  HANDLE_TAKEN_MESSAGE,
  LOGIN_ERROR_MESSAGE,
  type OracleResult,
  SESSION_COOKIE,
} from "@ghosthand/testbed-kit";
import { createAppApi } from "./app-api.ts";
import { createControlApi } from "./control-api.ts";
import { Testbed } from "./testbed.ts";

let testbed: Testbed;
let app: ReturnType<typeof createAppApi>;
let control: ReturnType<typeof createControlApi>;

beforeEach(() => {
  testbed = new Testbed();
  app = createAppApi(testbed);
  control = createControlApi(testbed);
});

function post(target: { request: typeof app.request }, path: string, body: unknown, cookie?: string) {
  return target.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

async function login(password: string = fixtureSecrets.TESTBED_PASSWORD): Promise<Response> {
  return post(app, "/api/login", { email: ALICE_EMAIL, password });
}

function sessionCookie(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(header);
  if (!match?.[1]) throw new Error(`no session cookie in ${header}`);
  return `${SESSION_COOKIE}=${match[1]}`;
}

function oracle(task: string, answer?: string): Promise<OracleResult> {
  const query = answer === undefined ? "" : `?answer=${encodeURIComponent(answer)}`;
  return json<OracleResult>(control.request(`/oracle/${task}${query}`));
}

describe("reset", () => {
  test("is deterministic for the same seed and differs for another", async () => {
    await post(control, "/reset", { seed: 7 });
    const first = await json<Record<string, unknown[]>>(control.request("/dump"));
    await login();
    await post(control, "/seed/welcome-mail", {});
    await post(control, "/reset", { seed: 7 });
    const second = await json<Record<string, unknown[]>>(control.request("/dump"));
    expect(second).toEqual(first);
    expect(first.users?.length).toBe(10);
    expect(first.sessions).toEqual([]);
    expect(first.mail).toEqual([]);

    await post(control, "/reset", { seed: 8 });
    const other = await json<Record<string, unknown[]>>(control.request("/dump"));
    expect(other.users).not.toEqual(first.users);
  });

  test("sets the variant and writes a control audit row", async () => {
    const res = await json<{ variant: unknown }>(post(control, "/reset", { variant: { testids: "on" } }));
    expect(res.variant).toEqual({ testids: "on", a11y: "good" });
    const config = await json<{ variant: unknown }>(app.request("/api/config"));
    expect(config.variant).toEqual({ testids: "on", a11y: "good" });
    expect(testbed.snapshot().audit.map((r) => [r.actor, r.action])).toEqual([["control", "control.reset"]]);
  });

  test("rejects malformed bodies", async () => {
    expect((await post(control, "/reset", { seed: -1 })).status).toBe(400);
    expect((await post(control, "/clock", { iso: "yesterday" })).status).toBe(400);
    expect((await post(control, "/seed/nope", {})).status).toBe(404);
    expect((await control.request("/oracle/nope")).status).toBe(404);
  });
});

describe("clock and mail", () => {
  test("the clock stamps audit rows and mail", async () => {
    await post(control, "/clock", { iso: "2026-05-01T12:00:00Z" });
    await post(control, "/seed/welcome-mail", {});
    const mail = await json<{ messages: { at: string; subject: string }[] }>(control.request("/mail"));
    expect(mail.messages).toEqual([expect.objectContaining({ at: "2026-05-01T12:00:00.000Z" })]);
  });

  test("the in-app mailbox needs a session and shows only the user's mail", async () => {
    await post(control, "/seed/welcome-mail", {});
    expect((await app.request("/api/mail")).status).toBe(401);
    const cookie = sessionCookie(await login());
    const mine = await json<{ messages: unknown[] }>(app.request("/api/mail", { headers: { cookie } }));
    expect(mine.messages).toHaveLength(1);
  });
});

describe("login", () => {
  test("wrong password: 401, no session, rejected audit row without the password", async () => {
    const res = await login(fixtureSecrets.TESTBED_WRONG_PASSWORD);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: LOGIN_ERROR_MESSAGE });
    expect(JSON.stringify(testbed.dump())).not.toContain(fixtureSecrets.TESTBED_WRONG_PASSWORD);
    const verdict = await oracle("l1-login-wrong-password", LOGIN_ERROR_MESSAGE);
    expect(verdict.pass).toBe(true);
    expect((await oracle("l1-login")).pass).toBe(false);
  });

  test("right password: cookie session, /me, oracle passes", async () => {
    expect((await oracle("l1-login")).pass).toBe(false);
    const res = await login();
    expect(res.status).toBe(200);
    const cookie = sessionCookie(res);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    const me = await json<{ user: { email: string } }>(app.request("/api/me", { headers: { cookie } }));
    expect(me.user.email).toBe(ALICE_EMAIL);
    expect((await oracle("l1-login")).pass).toBe(true);
    expect((await oracle("l1-login-wrong-password")).pass).toBe(false);
  });

  test("logout deletes the session", async () => {
    const cookie = sessionCookie(await login());
    await post(app, "/api/logout", {}, cookie);
    const me = await json<{ user: unknown }>(app.request("/api/me", { headers: { cookie } }));
    expect(me.user).toBeNull();
  });
});

describe("profile", () => {
  const alice = {
    name: "Alice Archer",
    handle: "alice",
    title: "Engineer",
    website: "https://alice.example",
    bio: "Builds test fixtures.",
  };
  function put(body: unknown, cookie?: string) {
    return app.request("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  }

  test("requires a session", async () => {
    expect((await put(alice)).status).toBe(401);
  });

  test("server validation mirrors the client rules", async () => {
    const cookie = sessionCookie(await login());
    const res = await put({ ...alice, name: "", website: "alice.dev" }, cookie);
    expect(res.status).toBe(400);
    const body = await json<{ fieldErrors: Record<string, string> }>(res);
    expect(Object.keys(body.fieldErrors).sort()).toEqual(["name", "website"]);
  });

  test("update-profile oracle passes after a valid update", async () => {
    const cookie = sessionCookie(await login());
    expect((await oracle("l1-update-profile")).pass).toBe(false);
    const res = await put({ ...alice, name: "Alice Moreau", title: "Staff Engineer" }, cookie);
    expect(res.status).toBe(200);
    expect(await oracle("l1-update-profile")).toEqual({
      pass: true,
      checks: {
        nameUpdated: true,
        titleUpdated: true,
        otherFieldsUnchanged: true,
        otherUsersUnchanged: true,
        updateAudited: true,
        confirmationMailed: true,
      },
    });
  });

  test("taken handle is rejected by the server; form-validation oracle needs both attempts", async () => {
    const cookie = sessionCookie(await login());
    const taken = await put({ ...alice, handle: "bob" }, cookie);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({
      error: "validation",
      fieldErrors: { handle: HANDLE_TAKEN_MESSAGE },
    });
    expect((await oracle("l1-form-validation")).pass).toBe(false);
    expect((await put({ ...alice, handle: "alice-dev" }, cookie)).status).toBe(200);
    expect((await oracle("l1-form-validation")).pass).toBe(true);
  });
});
