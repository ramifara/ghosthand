// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Thin client for the app API under /api (same origin, cookie session).
import type { FieldErrors, ProfileInput } from "@ghosthand/testbed-kit/profile-schema";
import { MailRow, UserRow } from "@ghosthand/testbed-kit/schemas";
import { Variant } from "@ghosthand/testbed-kit/variant";
import { z } from "zod";

export type User = UserRow;
export type Mail = MailRow;

const Config = z.object({ variant: Variant, resetId: z.number(), now: z.string() });
export type Config = z.infer<typeof Config>;
const Home = z.object({ buildCode: z.string(), releaseName: z.string(), openTickets: z.number() });
export type Home = z.infer<typeof Home>;
const Me = z.object({ user: UserRow.nullable() });
const ErrorBody = z.object({
  error: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
});

export type ApiResult<T> = { ok: true; value: T } | { ok: false; message: string; fieldErrors?: FieldErrors };

async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  init?: { method: string; body?: unknown },
): Promise<ApiResult<z.infer<S>>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      credentials: "same-origin",
      ...(init?.body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
    });
  } catch {
    return { ok: false, message: "The server could not be reached. Try again." };
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ErrorBody.safeParse(json);
    if (!parsed.success) return { ok: false, message: `Request failed (${res.status}).` };
    return parsed.data.fieldErrors
      ? { ok: false, message: parsed.data.error, fieldErrors: parsed.data.fieldErrors as FieldErrors }
      : { ok: false, message: parsed.data.error };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: "Unexpected server response." };
}

export const api = {
  config: () => request(Config, "/api/config"),
  home: () => request(Home, "/api/home"),
  me: () => request(Me, "/api/me"),
  login: (email: string, password: string) =>
    request(z.object({ user: UserRow }), "/api/login", { method: "POST", body: { email, password } }),
  logout: () => request(z.object({ ok: z.boolean() }), "/api/logout", { method: "POST", body: {} }),
  updateProfile: (profile: ProfileInput) =>
    request(z.object({ user: UserRow, message: z.string() }), "/api/profile", {
      method: "PUT",
      body: profile,
    }),
  mail: () => request(z.object({ messages: z.array(MailRow) }), "/api/mail"),
};
