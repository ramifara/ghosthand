// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Secrets encrypted with Electron safeStorage, kept in main only. Each value is encrypted on its own and
// the file (0600) maps names to ciphertext. On Linux without a keyring safeStorage falls back to
// `basic_text` (a hard-coded key): then values stay in memory for the session unless the user opts in
// to persisting anyway. The renderer only ever sees names and the backend status.
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
}

export type SecretStoreError = { kind: "io" | "unavailable"; message: string };

const FileShape = z.object({ version: z.literal(1), entries: z.record(z.string(), z.string()) });

export const BASIC_TEXT_WARNING =
  "No system keyring found (safeStorage uses basic_text). Secrets stay in memory for this session only. " +
  "Install and unlock GNOME Keyring or KWallet, or allow plain persistence in Settings → Developer.";

export class SecretStore {
  readonly #opts: SecretStoreOptions;
  readonly #memory = new Map<string, string>();
  #persistWithoutKeyring: boolean;

  constructor(opts: SecretStoreOptions) {
    this.#opts = opts;
    this.#persistWithoutKeyring = opts.persistWithoutKeyring ?? false;
    this.#load();
  }

  backend(): string {
    const { platform, safeStorage } = this.#opts;
    if (platform === "darwin") return "keychain";
    if (platform === "win32") return "dpapi";
    return safeStorage.getSelectedStorageBackend?.() ?? "unknown";
  }

  /** Values are written to disk only when encryption is real (or the user accepted basic_text). */
  persistent(): boolean {
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
    const warning = !this.#opts.safeStorage.isEncryptionAvailable()
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
    if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return;
    try {
      const parsed = FileShape.safeParse(JSON.parse(readFileSync(file, "utf8")));
      if (!parsed.success) return;
      for (const [name, b64] of Object.entries(parsed.data.entries)) {
        try {
          this.#memory.set(name, safeStorage.decryptString(Buffer.from(b64, "base64")));
        } catch {
          // A value from another machine or keyring cannot be decrypted; skip it.
        }
      }
    } catch {
      // Corrupt file: start empty; the next save rewrites it.
    }
  }

  #save(): Result<void, SecretStoreError> {
    const { file, safeStorage } = this.#opts;
    const entries: Record<string, string> = {};
    if (this.persistent()) {
      try {
        for (const [name, value] of this.#memory) {
          entries[name] = safeStorage.encryptString(value).toString("base64");
        }
      } catch (e) {
        return err({ kind: "unavailable", message: e instanceof Error ? e.message : String(e) });
      }
    }
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
      renameSync(tmp, file);
      if (this.#opts.platform !== "win32") chmodSync(file, 0o600);
      return ok(undefined);
    } catch (e) {
      return err({ kind: "io", message: e instanceof Error ? e.message : String(e) });
    }
  }
}
