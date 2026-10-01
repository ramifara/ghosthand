// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// "Sign in with ChatGPT" plan usage (SIWC preview, 2026-09-29), the documented public-client flow from
// docs/research/notes/codex-subscription.md §1a, cross-checked with pi-ai's MIT `openai-chatgpt.ts`:
// dynamic client registration, PKCE S256, 127.0.0.1 loopback redirect, token exchange and refresh at
// auth.openai.com, tokens used only against https://api.openai.com/v1. No client secret.
// Every network call takes an injected fetch; tests never touch the network.
import { err, ok, type Result } from "@ghosthand/protocol";
import { z } from "zod";

export const SIWC = {
  /** First sign-in registers a client; the callback returns the issued `oaiapp_...` client id. */
  dynamicClientId: "dynamic_agent_client",
  authorizeUrl: "https://auth.openai.com/api/accounts/authorize",
  tokenUrl: "https://auth.openai.com/api/accounts/oauth/token",
  issuer: "https://auth.openai.com",
  resource: "https://api.openai.com/v1",
  directScope: "chatgpt.tokens.use.direct",
  scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
  callbackPath: "/auth/callback",
  /** Shared convention with Codex CLI logins; SIWC allows another port when it is busy. */
  preferredPort: 1455,
  agentName: "GhostHand",
  /** Refresh this long before expiry. */
  expiryMarginMs: 3 * 60 * 1000,
} as const;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SiwcError =
  | { kind: "callback"; message: string }
  | { kind: "state_mismatch"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "token"; message: string; status?: number }
  | { kind: "id_token"; message: string }
  | { kind: "scope"; message: string }
  | { kind: "network"; message: string };

export const ChatGptCredential = z.object({
  clientId: z.string().min(1),
  access: z.string().min(1),
  refresh: z.string().min(1),
  /** Epoch ms, already reduced by the expiry margin. */
  expires: z.number(),
  scopes: z.array(z.string()),
  /** OIDC subject (identity), when the id token had one. */
  sub: z.string().optional(),
  hostId: z.string(),
});
export type ChatGptCredential = z.infer<typeof ChatGptCredential>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `ext_agent_host_id`: a stable opaque id per installation, as `urn:uuid:<v4>`. */
export function agentHostId(uuid: string): string {
  if (!UUID.test(uuid)) throw new Error("agent host id needs a UUID");
  return `urn:uuid:${uuid.toLowerCase()}`;
}

export function redirectUriFor(port: number): string {
  return `http://127.0.0.1:${port}${SIWC.callbackPath}`;
}

export interface AuthorizeParams {
  challenge: string;
  state: string;
  nonce: string;
  redirectUri: string;
  hostId: string;
  /** Issued client id from an earlier sign-in; the dynamic id on first registration. */
  clientId?: string;
}

export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const firstRegistration = p.clientId === undefined;
  const url = new URL(SIWC.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: p.clientId ?? SIWC.dynamicClientId,
    ...(firstRegistration ? { agent_name_hint: SIWC.agentName } : {}),
    ext_agent_host_id: p.hostId,
    response_type: "code",
    redirect_uri: p.redirectUri,
    resource: SIWC.resource,
    scope: SIWC.scope,
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export interface CallbackResult {
  code: string;
  clientId: string;
}

/** Validates the loopback callback (or a pasted redirect URL) against the expected redirect and state. */
export function parseCallback(
  raw: string,
  expected: { state: string; redirectUri: string; fallbackClientId?: string },
): Result<CallbackResult, SiwcError> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return err({ kind: "callback", message: "paste the full redirect URL from the browser" });
  }
  const want = new URL(expected.redirectUri);
  if (url.origin !== want.origin || url.pathname !== want.pathname) {
    return err({ kind: "callback", message: `the redirect URL must start with ${expected.redirectUri}` });
  }
  const error = url.searchParams.get("error");
  if (error) return err({ kind: "denied", message: `ChatGPT sign-in failed: ${error.slice(0, 120)}` });
  const state = url.searchParams.get("state");
  if (!state || state !== expected.state) {
    return err({ kind: "state_mismatch", message: "sign-in state did not match; start again" });
  }
  const code = url.searchParams.get("code");
  if (!code) return err({ kind: "callback", message: "the callback has no authorization code" });
  const clientId = url.searchParams.get("client_id")?.trim() || expected.fallbackClientId;
  if (!clientId) return err({ kind: "callback", message: "the callback has no issued client id" });
  return ok({ code, clientId });
}

const TokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  id_token: z.string().min(1).optional(),
  scope: z.string().min(1),
});
type TokenResponse = z.infer<typeof TokenResponse>;

async function postToken(body: URLSearchParams, f: FetchLike): Promise<Result<TokenResponse, SiwcError>> {
  let res: Response;
  try {
    res = await f(SIWC.tokenUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return err({ kind: "network", message: e instanceof Error ? e.message : String(e) });
  }
  if (!res.ok) {
    // Error bodies are OAuth error codes; keep them short and never echo tokens.
    const text = (await res.text().catch(() => "")).slice(0, 200);
    return err({
      kind: "token",
      status: res.status,
      message: `token request failed (${res.status}) ${text}`,
    });
  }
  const parsed = TokenResponse.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) return err({ kind: "token", message: "unexpected token response" });
  return ok(parsed.data);
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | undefined {
  const part = jwt.split(".")[1];
  if (!part) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks the id token's claims: issuer, audience (the issued client id), expiry and nonce. The token comes
 * straight from the token endpoint over TLS, which OIDC Core §3.1.3.7 accepts in place of a signature
 * check. TODO: verify the signature against OpenAI's JWKS once its URL is confirmed (note marks it [U]).
 */
export function validateIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string; now: number },
): Result<{ sub?: string }, SiwcError> {
  const claims = decodeJwtPayload(idToken);
  if (!claims) return err({ kind: "id_token", message: "id token is not a JWT" });
  const iss = typeof claims.iss === "string" ? claims.iss.replace(/\/$/, "") : "";
  if (iss !== SIWC.issuer) return err({ kind: "id_token", message: "id token issuer mismatch" });
  const aud = claims.aud;
  const audOk = aud === expected.clientId || (Array.isArray(aud) && aud.includes(expected.clientId));
  if (!audOk) return err({ kind: "id_token", message: "id token audience mismatch" });
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= expected.now) {
    return err({ kind: "id_token", message: "id token expired" });
  }
  if (claims.nonce !== expected.nonce) return err({ kind: "id_token", message: "id token nonce mismatch" });
  return ok(typeof claims.sub === "string" ? { sub: claims.sub } : {});
}

function credentialFrom(
  token: TokenResponse,
  base: { clientId: string; hostId: string; refresh?: string; sub?: string },
  now: number,
): Result<ChatGptCredential, SiwcError> {
  const scopes = token.scope.trim().split(/\s+/).filter(Boolean);
  if (!scopes.includes(SIWC.directScope)) {
    return err({ kind: "scope", message: `the grant did not include ${SIWC.directScope}` });
  }
  const refresh = token.refresh_token ?? base.refresh;
  if (!refresh) return err({ kind: "token", message: "token response has no refresh token" });
  return ok({
    clientId: base.clientId,
    access: token.access_token,
    refresh,
    expires: now + token.expires_in * 1000 - SIWC.expiryMarginMs,
    scopes,
    hostId: base.hostId,
    ...(base.sub ? { sub: base.sub } : {}),
  });
}

export async function exchangeCode(
  p: { code: string; verifier: string; clientId: string; redirectUri: string; nonce: string; hostId: string },
  f: FetchLike,
  now: () => number = Date.now,
): Promise<Result<ChatGptCredential, SiwcError>> {
  const token = await postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: p.clientId,
      code: p.code,
      code_verifier: p.verifier,
      redirect_uri: p.redirectUri,
      resource: SIWC.resource,
    }),
    f,
  );
  if (!token.ok) return token;
  if (!token.value.id_token) return err({ kind: "id_token", message: "token response has no id token" });
  const id = validateIdToken(token.value.id_token, { clientId: p.clientId, nonce: p.nonce, now: now() });
  if (!id.ok) return id;
  return credentialFrom(
    token.value,
    { clientId: p.clientId, hostId: p.hostId, ...(id.value.sub ? { sub: id.value.sub } : {}) },
    now(),
  );
}

export async function refreshCredential(
  cred: ChatGptCredential,
  f: FetchLike,
  now: () => number = Date.now,
): Promise<Result<ChatGptCredential, SiwcError>> {
  const token = await postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: cred.clientId,
      refresh_token: cred.refresh,
      resource: SIWC.resource,
    }),
    f,
  );
  if (!token.ok) return token;
  return credentialFrom(
    token.value,
    {
      clientId: cred.clientId,
      hostId: cred.hostId,
      refresh: cred.refresh,
      ...(cred.sub ? { sub: cred.sub } : {}),
    },
    now(),
  );
}
