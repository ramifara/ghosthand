// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The whole sign-in against a real loopback server on 127.0.0.1 (ephemeral port) and a fake token
// endpoint. The "browser" is a function that follows the authorize URL's redirect.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type SafeStorageLike, SecretStore } from "../secret-store.ts";
import { ChatGptAuth } from "./chatgpt-auth.ts";
import { startLoopbackServer } from "./loopback-server.ts";
import { type FetchLike, SIWC } from "./siwc.ts";

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s).reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString(),
  getSelectedStorageBackend: () => "gnome_libsecret",
};

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

function setup(opts: { enabled?: boolean; tokenStatus?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gh-chatgpt-"));
  let now = 1_800_000_000_000;
  let nonce = "";
  const tokenCalls: URLSearchParams[] = [];
  const fetch: FetchLike = async (url, init) => {
    if (url !== SIWC.tokenUrl) throw new Error(`unexpected network call to ${url}`);
    const body = new URLSearchParams(String(init?.body));
    tokenCalls.push(body);
    if (opts.tokenStatus && opts.tokenStatus !== 200) return new Response("{}", { status: opts.tokenStatus });
    const idToken = `x.${b64url({ iss: SIWC.issuer, aud: body.get("client_id"), exp: now / 1000 + 600, nonce, sub: "u1" })}.s`;
    return new Response(
      JSON.stringify({
        access_token: `at-${tokenCalls.length}`,
        refresh_token: "rt",
        expires_in: 3600,
        id_token: idToken,
        scope: SIWC.scope,
      }),
    );
  };
  const opened: string[] = [];
  const auth = new ChatGptAuth({
    store: new SecretStore({ file: join(dir, "auth.json"), safeStorage, platform: "linux" }),
    hostIdFile: join(dir, "host-id"),
    fetch,
    isEnabled: () => opts.enabled ?? true,
    now: () => now,
    startServer: (o) => startLoopbackServer({ ...o, preferredPort: 0 }),
    openExternal: async (url) => {
      opened.push(url);
      const q = new URL(url).searchParams;
      nonce = q.get("nonce") ?? "";
      const redirect = new URL(q.get("redirect_uri") ?? "");
      redirect.search = new URLSearchParams({
        code: "the-code",
        state: q.get("state") ?? "",
        client_id: "oaiapp_7",
      }).toString();
      // Simulate the browser following the redirect after the user consents.
      setTimeout(() => void globalThis.fetch(redirect).catch(() => {}), 10);
    },
  });
  return { auth, opened, tokenCalls, advance: (ms: number) => (now += ms) };
}

describe("ChatGptAuth", () => {
  it("is off behind the feature flag and makes no calls", async () => {
    const { auth, opened, tokenCalls } = setup({ enabled: false });
    const s = await auth.signIn();
    expect(s).toMatchObject({ enabled: false, signedIn: false });
    expect(s.error).toMatch(/turned off/);
    expect(opened).toHaveLength(0);
    expect(tokenCalls).toHaveLength(0);
    expect(await auth.accessToken()).toBeUndefined();
  });

  it("signs in through the loopback callback, stores tokens and refreshes near expiry", async () => {
    const { auth, opened, tokenCalls, advance } = setup();
    const s = await auth.signIn();
    expect(s).toMatchObject({ enabled: true, signedIn: true, pending: false });
    expect(opened[0]).toMatch(/^https:\/\/auth\.openai\.com\/api\/accounts\/authorize\?/);
    expect(new URL(opened[0] ?? "").searchParams.get("redirect_uri")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/,
    );
    expect(tokenCalls[0]?.get("grant_type")).toBe("authorization_code");
    expect(tokenCalls[0]?.get("client_id")).toBe("oaiapp_7");
    expect(await auth.accessToken()).toBe("at-1");
    advance(3600_000);
    expect(await auth.accessToken()).toBe("at-2");
    expect(tokenCalls[1]?.get("grant_type")).toBe("refresh_token");
    expect(auth.signOut().signedIn).toBe(false);
    expect(await auth.accessToken()).toBeUndefined();
  });

  it("keeps a stable agent host id", () => {
    const { auth } = setup();
    expect(auth.hostId()).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(auth.hostId()).toBe(auth.hostId());
  });

  it("reports a failed exchange without signing in", async () => {
    const { auth } = setup({ tokenStatus: 400 });
    const s = await auth.signIn();
    expect(s.signedIn).toBe(false);
    expect(s.error).toMatch(/token request failed \(400\)/);
  });
});
