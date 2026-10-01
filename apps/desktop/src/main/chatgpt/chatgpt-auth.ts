// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Orchestrates Sign in with ChatGPT in main: loopback server, system browser, PKCE exchange, encrypted
// token storage and refresh. Behind the `chatgptSignIn` feature flag (preview; see ADR 0008).
// Tokens never leave main except as a short-lived access token handed to the engine host per run.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatGptStatus } from "@ghosthand/protocol";
import type { SecretStore } from "../secret-store.ts";
import type { LoopbackServer } from "./loopback-server.ts";
import { startLoopbackServer } from "./loopback-server.ts";
import { createPkcePair, randomUrlSafe } from "./pkce.ts";
import {
  agentHostId,
  buildAuthorizeUrl,
  ChatGptCredential,
  exchangeCode,
  type FetchLike,
  parseCallback,
  refreshCredential,
  SIWC,
} from "./siwc.ts";

const CREDENTIAL_KEY = "CHATGPT_CREDENTIAL";

export interface ChatGptAuthDeps {
  /** Encrypted store for the credential (separate from user secrets). */
  store: SecretStore;
  /** Plain file holding this installation's agent host UUID (not a secret). */
  hostIdFile: string;
  openExternal: (url: string) => Promise<void>;
  fetch: FetchLike;
  isEnabled: () => boolean;
  onStatus?: (status: ChatGptStatus) => void;
  now?: () => number;
  startServer?: typeof startLoopbackServer;
}

interface Pending {
  state: string;
  nonce: string;
  verifier: string;
  server: LoopbackServer;
  manual: (url: string) => void;
}

export class ChatGptAuth {
  readonly #deps: ChatGptAuthDeps;
  #pending: Pending | undefined;
  #lastError: string | undefined;
  #refreshing: Promise<string | undefined> | undefined;

  constructor(deps: ChatGptAuthDeps) {
    this.#deps = deps;
  }

  #now(): number {
    return this.#deps.now?.() ?? Date.now();
  }

  #credential(): ChatGptCredential | undefined {
    const raw = this.#deps.store.get(CREDENTIAL_KEY);
    if (!raw) return undefined;
    try {
      const parsed = ChatGptCredential.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  #save(cred: ChatGptCredential): void {
    this.#deps.store.set(CREDENTIAL_KEY, JSON.stringify(cred));
  }

  hostId(): string {
    const file = this.#deps.hostIdFile;
    if (existsSync(file)) {
      const existing = readFileSync(file, "utf8").trim();
      try {
        return agentHostId(existing);
      } catch {
        // Rewrite a damaged file below.
      }
    }
    const uuid = randomUUID();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${uuid}\n`, { mode: 0o600 });
    return agentHostId(uuid);
  }

  status(): ChatGptStatus {
    const cred = this.#credential();
    return {
      enabled: this.#deps.isEnabled(),
      signedIn: cred !== undefined,
      pending: this.#pending !== undefined,
      ...(cred ? { expiresAt: cred.expires } : {}),
      scopes: cred?.scopes ?? [],
      ...(this.#lastError ? { error: this.#lastError } : {}),
    };
  }

  #emit(): ChatGptStatus {
    const s = this.status();
    this.#deps.onStatus?.(s);
    return s;
  }

  /** Starts the browser sign-in and resolves when it finishes, fails, times out or is cancelled. */
  async signIn(): Promise<ChatGptStatus> {
    if (!this.#deps.isEnabled()) {
      this.#lastError = "Sign in with ChatGPT is turned off (Settings → Developer → ChatGPT preview).";
      return this.#emit();
    }
    this.cancel();
    this.#lastError = undefined;
    const start = this.#deps.startServer ?? startLoopbackServer;
    const server = await start({ preferredPort: SIWC.preferredPort, path: SIWC.callbackPath });
    const { verifier, challenge } = createPkcePair();
    const state = randomUrlSafe();
    const nonce = randomUrlSafe();
    let manual!: (url: string) => void;
    const manualUrl = new Promise<string>((resolve) => {
      manual = resolve;
    });
    const pending: Pending = { state, nonce, verifier, server, manual };
    this.#pending = pending;
    const previous = this.#credential();
    const hostId = this.hostId();
    const authorize = buildAuthorizeUrl({
      challenge,
      state,
      nonce,
      redirectUri: server.redirectUri,
      hostId,
      ...(previous ? { clientId: previous.clientId } : {}),
    });
    this.#emit();
    const done = (error?: string): ChatGptStatus => {
      if (this.#pending === pending) {
        this.#pending = undefined;
        if (error !== undefined) this.#lastError = error;
      }
      server.close();
      return this.#emit();
    };
    try {
      await this.#deps.openExternal(authorize);
      const url = await Promise.race([server.callback, manualUrl]);
      if (this.#pending !== pending) return done();
      const cb = parseCallback(url, {
        state,
        redirectUri: server.redirectUri,
        ...(previous ? { fallbackClientId: previous.clientId } : {}),
      });
      if (!cb.ok) return done(cb.error.message);
      const cred = await exchangeCode(
        {
          code: cb.value.code,
          verifier,
          clientId: cb.value.clientId,
          redirectUri: server.redirectUri,
          nonce,
          hostId,
        },
        this.#deps.fetch,
        () => this.#now(),
      );
      if (!cred.ok) return done(cred.error.message);
      this.#save(cred.value);
      return done();
    } catch (e) {
      return done(e instanceof Error ? e.message : String(e));
    }
  }

  /** Fallback when the browser cannot reach the loopback server: the user pastes the final URL. */
  completeManual(url: string): ChatGptStatus {
    if (!this.#pending) {
      this.#lastError = "no sign-in is in progress";
      return this.status();
    }
    this.#pending.manual(url);
    return this.status();
  }

  cancel(): ChatGptStatus {
    const p = this.#pending;
    this.#pending = undefined;
    p?.server.close();
    return this.status();
  }

  /**
   * Forgets the tokens locally. TODO: call the SIWC revocation endpoint once its URL is confirmed (the note
   * marks it [U]); until then the grant stays valid server-side until it expires or the user revokes it in
   * ChatGPT settings.
   */
  signOut(): ChatGptStatus {
    this.cancel();
    this.#deps.store.delete(CREDENTIAL_KEY);
    this.#lastError = undefined;
    return this.#emit();
  }

  /** A valid access token, refreshed when within the expiry margin; undefined when signed out or disabled. */
  async accessToken(): Promise<string | undefined> {
    if (!this.#deps.isEnabled()) return undefined;
    const cred = this.#credential();
    if (!cred) return undefined;
    if (cred.expires > this.#now()) return cred.access;
    this.#refreshing ??= (async () => {
      const r = await refreshCredential(cred, this.#deps.fetch, () => this.#now());
      if (!r.ok) {
        this.#lastError = `ChatGPT token refresh failed: ${r.error.message}`;
        if (r.error.kind === "token" && (r.error.status === 400 || r.error.status === 401)) {
          this.#deps.store.delete(CREDENTIAL_KEY);
        }
        this.#emit();
        return undefined;
      }
      this.#save(r.value);
      return r.value.access;
    })().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }
}
