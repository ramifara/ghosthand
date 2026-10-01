// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Client for the L5 auth routes (two-step, magic link, email code, reset, status, dev mailbox) and the L6
// preferences/consent/promo routes. Failures keep the HTTP status so pages can offer Retry or re-sign-in.
import {
  Chrome,
  ConsentChoice,
  ContactPrefsRow,
  type PromoDecision,
} from "@ghosthand/testbed-kit/preferences";
import { MailRow, UserRow } from "@ghosthand/testbed-kit/schemas";
import { z } from "zod";

export type CallResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string; code?: string; fieldErrors?: Record<string, string> };

const ErrorBody = z.object({
  error: z.string(),
  code: z.string().optional(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
});

async function call<S extends z.ZodType>(
  schema: S,
  path: string,
  init?: { method: string; body?: unknown },
): Promise<CallResult<z.infer<S>>> {
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
    return { ok: false, status: 0, message: "The server could not be reached. Try again." };
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ErrorBody.safeParse(json);
    if (!parsed.success) return { ok: false, status: res.status, message: `Request failed (${res.status}).` };
    return {
      ok: false,
      status: res.status,
      message: parsed.data.error,
      ...(parsed.data.code ? { code: parsed.data.code } : {}),
      ...(parsed.data.fieldErrors ? { fieldErrors: parsed.data.fieldErrors } : {}),
    };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, status: res.status, message: "Unexpected server response." };
}

const post = (body: unknown) => ({ method: "POST", body });
const Message = z.object({ message: z.string() });
const SignedIn = z.object({ user: UserRow });
const Email = z.object({ email: z.string() });

/** `POST /api/login` answers with a user, or with a two-step challenge for TOTP users. */
export const LoginResponse = z.union([
  z.object({ user: UserRow }),
  z.object({ mfa: z.literal("totp"), message: z.string() }),
]);
const PrefsResponse = z.object({ prefs: ContactPrefsRow, message: z.string().optional() });

export const authApi = {
  login: (email: string, password: string) => call(LoginResponse, "/api/login", post({ email, password })),
  verifyTotp: (code: string) => call(SignedIn, "/api/auth/totp", post({ code })),
  requestMagicLink: (email: string) => call(Message, "/api/auth/magic-link", post({ email })),
  peekMagicLink: (token: string) => call(Email, `/api/auth/magic-link?token=${encodeURIComponent(token)}`),
  consumeMagicLink: (token: string) => call(SignedIn, "/api/auth/magic-link/consume", post({ token })),
  requestEmailCode: (email: string) => call(Message, "/api/auth/email-code", post({ email })),
  pendingEmailCode: () => call(z.object({ email: z.string().nullable() }), "/api/auth/email-code"),
  verifyEmailCode: (code: string) => call(SignedIn, "/api/auth/email-code/verify", post({ code })),
  requestReset: (email: string) => call(Message, "/api/auth/password-reset", post({ email })),
  peekReset: (token: string) => call(Email, `/api/auth/password-reset?token=${encodeURIComponent(token)}`),
  completeReset: (token: string, password: string, confirm: string) =>
    call(Message, "/api/auth/password-reset/complete", post({ token, password, confirm })),
  status: () => call(Message, "/api/status"),
  saveStatus: (message: string) =>
    call(z.object({ message: z.string(), notice: z.string() }), "/api/status", {
      method: "PUT",
      body: { message },
    }),
  mailbox: (address: string) =>
    call(z.object({ messages: z.array(MailRow) }), `/api/mailbox?address=${encodeURIComponent(address)}`),
  preferences: () => call(PrefsResponse, "/api/preferences"),
  savePreferences: (input: { phone: string; method: string; news: boolean }) =>
    call(PrefsResponse, "/api/preferences", { method: "PUT", body: input }),
  unsubscribeAll: () => call(PrefsResponse, "/api/preferences/unsubscribe-all", post({})),
  chrome: () => call(Chrome, "/api/chrome"),
  setConsent: (choice: z.infer<typeof ConsentChoice>) =>
    call(z.object({ consent: ConsentChoice }), "/api/consent", post({ choice })),
  decidePromo: (decision: PromoDecision) =>
    call(z.object({ decision: z.string() }), "/api/promo", post({ decision })),
};
