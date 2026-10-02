// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Secrets kept in main only, each value encrypted on its own; the file (0600) maps names to ciphertext.
// Backends: Electron safeStorage (Keychain, DPAPI, a Linux keyring), or a local key (AES-256-GCM with a
// random key in a 0600 file next to the secrets) for builds the OS cannot vouch for: an ad-hoc signed
// macOS app would get a Keychain password prompt on every launch. On Linux without a keyring safeStorage
// falls back to `basic_text` (a hard-coded key): then values stay in memory for the session unless the
// user opts in to persisting anyway. The renderer only ever sees names and the backend status.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SecretsStatus } from "@ghosthand/protocol";
import { err, ok, type Result } from "@ghosthand/protocol";
import { z } from "zod";

/** The parts of Electron's `safeStorage` we use; injected so tests can mock it. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only in Electron. */
  getSelectedStorageBackend?(): string;
}

export interface SecretStoreOptions {
  file: string;
  safeStorage: SafeStorageLike;
  platform: NodeJS.Platform;
  /** Persist even when the Linux backend is `basic_text`. */
  persistWithoutKeyring?: boolean;
  /**
   * Encrypt with a random key kept in this file instead of safeStorage (ad-hoc signed macOS builds).
   * Secrets already encrypted by safeStorage are re-encrypted on first load, which may prompt once.
   */
  localKeyFile?: string;
}

export type SecretStoreError = { kind: "io" | "unavailable"; message: string };

const FileShape = z.union([
  z.object({ version: z.literal(1), entries: z.record(z.string(), z.string()) }),
  z.object({
    version: z.literal(2),
    backend: z.enum(["safe_storage", "local_key"]),
    entries: z.record(z.string(), z.string()),
  }),
]);

export const BASIC_TEXT_WARNING =
  "No system keyring found (safeStorage uses basic_text). Secrets stay in memory for this session only. " +
  "Install and unlock GNOME Keyring or KWallet, or allow plain persistence in Settings → Developer.";

export const LOCAL_KEY_WARNING =
  "This build is not signed with an Apple Developer ID, so the Keychain would ask for your password on " +
  "every launch. Secrets are encrypted with a key kept in GhostHand's data folder instead (readable by " +
  "your user account).";

const KEY_BYTES = 32;
const IV_BYTES = 12;

export class SecretStore {
  readonly #opts: SecretStoreOptions;
  readonly #memory = new Map<string, string>();
  #persistWithoutKeyring: boolean;
  #localKey: Buffer | undefined;

  constructor(opts: SecretStoreOptions) {
    this.#opts = opts;
    this.#persistWithoutKeyring = opts.persistWithoutKeyring ?? false;
    this.#load();
  }

  backend(): string {
    const { platform, safeStorage, localKeyFile } = this.#opts;
    if (localKeyFile) return "local_key";
    if (platform === "darwin") return "keychain";
    if (platform === "win32") return "dpapi";
    return safeStorage.getSelectedStorageBackend?.() ?? "unknown";
  }

  /** Values are written to disk only when encryption is real (or the user accepted basic_text). */
  persistent(): boolean {
    if (this.#opts.localKeyFile) return true;
    if (!this.#opts.safeStorage.isEncryptionAvailable()) return false;
    if (this.#opts.platform === "linux" && this.backend() === "basic_text")
      return this.#persistWithoutKeyring;
    return true;
  }

  setPersistWithoutKeyring(value: boolean): void {
    this.#persistWithoutKeyring = value;
    if (this.persistent()) this.#save();
  }

  status(): SecretsStatus {
    const backend = this.backend();
    const warning =
      backend === "local_key"
        ? LOCAL_KEY_WARNING
        : !this.#opts.safeStorage.isEncryptionAvailable()
          ? "Encryption is unavailable; secrets stay in memory for this session only."
          : this.#opts.platform === "linux" && backend === "basic_text"
            ? this.#persistWithoutKeyring
              ? "No system keyring: secrets are persisted with Chromium's basic_text key (obfuscation, not encryption)."
              : BASIC_TEXT_WARNING
            : undefined;
    return {
      names: [...this.#memory.keys()].sort(),
      backend,
      persistent: this.persistent(),
      ...(warning ? { warning } : {}),
    };
  }

  has(name: string): boolean {
    return this.#memory.has(name);
  }

  /** Main-process only. Never pass the result to a renderer. */
  get(name: string): string | undefined {
    return this.#memory.get(name);
  }

  /** Main-process only: every value, for handing to the engine host. */
  entries(): Record<string, string> {
    return Object.fromEntries(this.#memory);
  }

  set(name: string, value: string): Result<void, SecretStoreError> {
    this.#memory.set(name, value);
    return this.persistent() ? this.#save() : ok(undefined);
  }

  delete(name: string): Result<void, SecretStoreError> {
    this.#memory.delete(name);
    return this.persistent() || existsSync(this.#opts.file) ? this.#save() : ok(undefined);
  }

  #load(): void {
    const { file, safeStorage } = this.#opts;
    if (!existsSync(file)) return;
    let parsed: z.infer<typeof FileShape>;
    try {
      const r = FileShape.safeParse(JSON.parse(readFileSync(file, "utf8")));
      if (!r.success) return;
      parsed = r.data;
    } catch {
      // Corrupt file: start empty; the next save rewrites it.
      return;
    }
    const stored = parsed.version === 1 ? "safe_storage" : parsed.backend;
    if (stored === "safe_storage" && !safeStorage.isEncryptionAvailable()) return;
    for (const [name, b64] of Object.entries(parsed.entries)) {
      try {
        const bytes = Buffer.from(b64, "base64");
        this.#memory.set(
          name,
          stored === "local_key" ? this.#decryptLocal(bytes) : safeStorage.decryptString(bytes),
        );
      } catch {
        // A value from another machine, keyring or key cannot be decrypted; skip it.
      }
    }
    // Written by another backend (a Keychain file on a build that now keeps its own key): re-encrypt once.
    if (stored !== (this.#opts.localKeyFile ? "local_key" : "safe_storage") && this.persistent())
      this.#save();
  }

  #key(): Buffer {
    if (this.#localKey) return this.#localKey;
    const path = this.#opts.localKeyFile;
    if (!path) throw new Error("no local key file configured");
    if (existsSync(path)) {
      const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
      if (key.length === KEY_BYTES) {
        this.#localKey = key;
        return key;
      }
    }
    const key = randomBytes(KEY_BYTES);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, key.toString("base64"), { mode: 0o600 });
    if (this.#opts.platform !== "win32") chmodSync(path, 0o600);
    this.#localKey = key;
    return key;
  }

  /** iv ‖ tag ‖ ciphertext, AES-256-GCM. */
  #encryptLocal(plain: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key(), iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  #decryptLocal(bytes: Buffer): string {
    const iv = bytes.subarray(0, IV_BYTES);
    const tag = bytes.subarray(IV_BYTES, IV_BYTES + 16);
    const body = bytes.subarray(IV_BYTES + 16);
    const decipher = createDecipheriv("aes-256-gcm", this.#key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  }

  #save(): Result<void, SecretStoreError> {
    const { file, safeStorage, localKeyFile } = this.#opts;
    const entries: Record<string, string> = {};
    if (this.persistent()) {
      try {
        for (const [name, value] of this.#memory) {
          const bytes = localKeyFile ? this.#encryptLocal(value) : safeStorage.encryptString(value);
          entries[name] = bytes.toString("base64");
        }
      } catch (e) {
        return err({ kind: "unavailable", message: e instanceof Error ? e.message : String(e) });
      }
    }
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp`;
      const backend = localKeyFile ? "local_key" : "safe_storage";
      writeFileSync(tmp, JSON.stringify({ version: 2, backend, entries }), { mode: 0o600 });
      renameSync(tmp, file);
      if (this.#opts.platform !== "win32") chmodSync(file, 0o600);
      return ok(undefined);
    } catch (e) {
      return err({ kind: "io", message: e instanceof Error ? e.message : String(e) });
    }
  }
}
