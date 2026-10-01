// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// PKCE and SIWC protocol helpers. Every network call goes to an injected fake fetch.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPkcePair, s256 } from "./pkce.ts";
import {
  agentHostId,
  buildAuthorizeUrl,
  type ChatGptCredential,
  exchangeCode,
  type FetchLike,
  parseCallback,
  refreshCredential,
  SIWC,
  validateIdToken,
} from "./siwc.ts";

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "RS256" })}.${b64url(claims)}.sig`;

function tokenFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, body: new URLSearchParams(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { f, calls };
}

describe("PKCE", () => {
  it("makes an RFC 7636 S256 pair", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(s256("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });
});

describe("authorize URL", () => {
  it("uses the documented endpoint, scope, resource and loopback redirect", () => {
    const url = new URL(
      buildAuthorizeUrl({
        challenge: "c",
        state: "s",
        nonce: "n",
        redirectUri: "http://127.0.0.1:1455/auth/callback",
        hostId: agentHostId("0f8fad5b-d9cb-469f-a165-70867728950e"),
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(SIWC.authorizeUrl);
    const q = url.searchParams;
    expect(q.get("client_id")).toBe("dynamic_agent_client");
    expect(q.get("agent_name_hint")).toBe("GhostHand");
    expect(q.get("scope")).toBe(
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    );
    expect(q.get("resource")).toBe("https://api.openai.com/v1");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("ext_agent_host_id")).toBe("urn:uuid:0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:1455/auth/callback");
    expect(url.toString()).not.toContain("backend-api");
  });

  it("reuses an issued client id without the name hint", () => {
    const q = new URL(
      buildAuthorizeUrl({
        challenge: "c",
        state: "s",
        nonce: "n",
        redirectUri: "r",
        hostId: "h",
        clientId: "oaiapp_1",
      }),
    ).searchParams;
    expect(q.get("client_id")).toBe("oaiapp_1");
    expect(q.has("agent_name_hint")).toBe(false);
  });

  it("rejects a non-UUID host id", () => {
    expect(() => agentHostId("not-a-uuid")).toThrow();
  });
});

describe("parseCallback", () => {
  const expected = { state: "st", redirectUri: "http://127.0.0.1:1455/auth/callback" };
  it("accepts the right redirect with state, code and issued client id", () => {
    const r = parseCallback(
      "http://127.0.0.1:1455/auth/callback?code=abc&state=st&client_id=oaiapp_9",
      expected,
    );
    expect(r).toEqual({ ok: true, value: { code: "abc", clientId: "oaiapp_9" } });
  });
  it("rejects state mismatch, errors, other paths and hosts", () => {
    expect(
      parseCallback("http://127.0.0.1:1455/auth/callback?code=a&state=x&client_id=c", expected),
    ).toMatchObject({
      ok: false,
      error: { kind: "state_mismatch" },
    });
    expect(parseCallback("http://127.0.0.1:1455/auth/callback?error=access_denied", expected)).toMatchObject({
      ok: false,
      error: { kind: "denied" },
    });
    expect(
      parseCallback("http://localhost:1455/auth/callback?code=a&state=st&client_id=c", expected).ok,
    ).toBe(false);
    expect(parseCallback("http://127.0.0.1:1455/other?code=a&state=st&client_id=c", expected).ok).toBe(false);
    expect(parseCallback("garbage", expected).ok).toBe(false);
  });
});

describe("token exchange", () => {
  const now = 1_800_000_000_000;
  const idToken = (over: Record<string, unknown> = {}) =>
    jwt({
      iss: "https://auth.openai.com",
      aud: "oaiapp_9",
      exp: now / 1000 + 600,
      nonce: "nn",
      sub: "user-1",
      ...over,
    });
  const good = {
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    id_token: idToken(),
    scope: SIWC.scope,
  };

  it("exchanges the code with PKCE and the resource, and validates the id token", async () => {
    const { f, calls } = tokenFetch(good);
    const r = await exchangeCode(
      {
        code: "abc",
        verifier: "v",
        clientId: "oaiapp_9",
        redirectUri: "http://127.0.0.1:1455/auth/callback",
        nonce: "nn",
        hostId: "urn:uuid:x",
      },
      f,
      () => now,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({ access: "at", refresh: "rt", clientId: "oaiapp_9", sub: "user-1" });
      expect(r.value.expires).toBe(now + 3600_000 - SIWC.expiryMarginMs);
    }
    expect(calls[0]?.url).toBe(SIWC.tokenUrl);
    expect(Object.fromEntries(calls[0]?.body ?? [])).toEqual({
      grant_type: "authorization_code",
      client_id: "oaiapp_9",
      code: "abc",
      code_verifier: "v",
      redirect_uri: "http://127.0.0.1:1455/auth/callback",
      resource: "https://api.openai.com/v1",
    });
  });

  it("fails closed on a missing direct-use scope, bad id token or HTTP error", async () => {
    const p = { code: "a", verifier: "v", clientId: "oaiapp_9", redirectUri: "r", nonce: "nn", hostId: "h" };
    expect(await exchangeCode(p, tokenFetch({ ...good, scope: "openid" }).f, () => now)).toMatchObject({
      ok: false,
      error: { kind: "scope" },
    });
    expect(
      await exchangeCode(p, tokenFetch({ ...good, id_token: idToken({ nonce: "other" }) }).f, () => now),
    ).toMatchObject({ ok: false, error: { kind: "id_token" } });
    expect(await exchangeCode(p, tokenFetch({ error: "invalid_grant" }, 400).f, () => now)).toMatchObject({
      ok: false,
      error: { kind: "token", status: 400 },
    });
  });

  it("validates id token claims", () => {
    const base = { clientId: "oaiapp_9", nonce: "nn", now };
    expect(validateIdToken(idToken(), base).ok).toBe(true);
    expect(validateIdToken(idToken({ iss: "https://evil" }), base).ok).toBe(false);
    expect(validateIdToken(idToken({ aud: "someone-else" }), base).ok).toBe(false);
    expect(validateIdToken(idToken({ aud: ["x", "oaiapp_9"] }), base).ok).toBe(true);
    expect(validateIdToken(idToken({ exp: now / 1000 - 1 }), base).ok).toBe(false);
    expect(validateIdToken("nope", base).ok).toBe(false);
  });

  it("refreshes with the issued client id and keeps the old refresh token when none comes back", async () => {
    const cred: ChatGptCredential = {
      clientId: "oaiapp_9",
      access: "old",
      refresh: "rt-1",
      expires: 0,
      scopes: [],
      hostId: "urn:uuid:x",
    };
    const { f, calls } = tokenFetch({ access_token: "new", expires_in: 60, scope: SIWC.scope });
    const r = await refreshCredential(cred, f, () => now);
    expect(r).toMatchObject({ ok: true, value: { access: "new", refresh: "rt-1" } });
    expect(Object.fromEntries(calls[0]?.body ?? [])).toEqual({
      grant_type: "refresh_token",
      client_id: "oaiapp_9",
      refresh_token: "rt-1",
      resource: "https://api.openai.com/v1",
    });
  });
});
