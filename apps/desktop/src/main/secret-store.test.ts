// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// safeStorage is mocked: a reversible "encryption" that marks ciphertext so tests can see it on disk.
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASIC_TEXT_WARNING, LOCAL_KEY_WARNING, type SafeStorageLike, SecretStore } from "./secret-store.ts";

function fakeSafeStorage(opts: { available?: boolean; backend?: string } = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => opts.available ?? true,
    encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString("hex")}`),
    decryptString: (b) => {
      const t = b.toString();
      if (!t.startsWith("enc:")) throw new Error("bad ciphertext");
      return Buffer.from(t.slice(4), "hex").toString();
    },
    getSelectedStorageBackend: () => opts.backend ?? "gnome_libsecret",
  };
}

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "gh-secrets-")), "secrets.json");

describe("SecretStore", () => {
  it("encrypts each value, writes 0600 and reads back", () => {
    const file = tmpFile();
    const s = new SecretStore({ file, safeStorage: fakeSafeStorage(), platform: "linux" });
    expect(s.set("TYPESAFE_API_KEY", "ts-live-123").ok).toBe(true);
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain("ts-live-123");
    expect(raw).toContain("TYPESAFE_API_KEY");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = new SecretStore({ file, safeStorage: fakeSafeStorage(), platform: "linux" });
    expect(again.get("TYPESAFE_API_KEY")).toBe("ts-live-123");
    expect(again.status()).toEqual({
      names: ["TYPESAFE_API_KEY"],
      backend: "gnome_libsecret",
      persistent: true,
    });
  });

  it("status never contains values", () => {
    const s = new SecretStore({ file: tmpFile(), safeStorage: fakeSafeStorage(), platform: "linux" });
    s.set("SITE_PASSWORD", "hunter2-xyz");
    expect(JSON.stringify(s.status())).not.toContain("hunter2-xyz");
  });

  it("keeps secrets in memory and warns on Linux basic_text", () => {
    const file = tmpFile();
    const s = new SecretStore({
      file,
      safeStorage: fakeSafeStorage({ backend: "basic_text" }),
      platform: "linux",
    });
    s.set("OPENAI_API_KEY", "sk-abc");
    expect(s.get("OPENAI_API_KEY")).toBe("sk-abc");
    expect(s.status()).toMatchObject({
      persistent: false,
      warning: BASIC_TEXT_WARNING,
      backend: "basic_text",
    });
    expect(() => readFileSync(file)).toThrow();
    // Opting in persists.
    s.setPersistWithoutKeyring(true);
    expect(readFileSync(file, "utf8")).toContain("OPENAI_API_KEY");
    expect(s.status().persistent).toBe(true);
  });

  it("is memory-only when encryption is unavailable", () => {
    const s = new SecretStore({
      file: tmpFile(),
      safeStorage: fakeSafeStorage({ available: false }),
      platform: "darwin",
    });
    s.set("X_KEY", "v");
    expect(s.status()).toMatchObject({ persistent: false, backend: "keychain" });
    expect(s.status().warning).toMatch(/unavailable/);
  });

  it("deletes and skips undecryptable entries", () => {
    const file = tmpFile();
    const s = new SecretStore({ file, safeStorage: fakeSafeStorage(), platform: "win32" });
    s.set("A_KEY", "1");
    s.set("B_KEY", "2");
    s.delete("A_KEY");
    expect(
      new SecretStore({ file, safeStorage: fakeSafeStorage(), platform: "win32" }).status().names,
    ).toEqual(["B_KEY"]);
    const broken: SafeStorageLike = {
      ...fakeSafeStorage(),
      decryptString: () => {
        throw new Error("other keyring");
      },
    };
    expect(new SecretStore({ file, safeStorage: broken, platform: "win32" }).status().names).toEqual([]);
  });
});

describe("SecretStore with a local key (ad-hoc signed macOS builds)", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "gh-localkey-"));

  it("encrypts with its own key, never touches safeStorage, and reads back", () => {
    const d = dir();
    const file = join(d, "secrets.json");
    const localKeyFile = join(d, "secret-key");
    const untouched: SafeStorageLike = {
      isEncryptionAvailable: () => {
        throw new Error("safeStorage must not be used");
      },
      encryptString: () => {
        throw new Error("safeStorage must not be used");
      },
      decryptString: () => {
        throw new Error("safeStorage must not be used");
      },
    };
    const s = new SecretStore({ file, safeStorage: untouched, platform: "darwin", localKeyFile });
    expect(s.set("TYPESAFE_API_KEY", "ts-live-456").ok).toBe(true);
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain("ts-live-456");
    expect(raw).toContain('"backend":"local_key"');
    expect(statSync(localKeyFile).mode & 0o777).toBe(0o600);
    const again = new SecretStore({ file, safeStorage: untouched, platform: "darwin", localKeyFile });
    expect(again.get("TYPESAFE_API_KEY")).toBe("ts-live-456");
    expect(again.status()).toMatchObject({
      backend: "local_key",
      persistent: true,
      warning: LOCAL_KEY_WARNING,
    });
  });

  it("migrates a Keychain-encrypted file to the local key on first load", () => {
    const d = dir();
    const file = join(d, "secrets.json");
    const keychain = fakeSafeStorage();
    new SecretStore({ file, safeStorage: keychain, platform: "darwin" }).set("OPENAI_API_KEY", "sk-old");
    expect(readFileSync(file, "utf8")).toContain('"backend":"safe_storage"');
    const localKeyFile = join(d, "secret-key");
    const s = new SecretStore({ file, safeStorage: keychain, platform: "darwin", localKeyFile });
    expect(s.get("OPENAI_API_KEY")).toBe("sk-old");
    expect(readFileSync(file, "utf8")).toContain('"backend":"local_key"');
    // The migrated file no longer needs safeStorage.
    const noKeychain = fakeSafeStorage({ available: false });
    expect(
      new SecretStore({ file, safeStorage: noKeychain, platform: "darwin", localKeyFile }).get(
        "OPENAI_API_KEY",
      ),
    ).toBe("sk-old");
  });

  it("drops values whose key is gone instead of failing", () => {
    const d = dir();
    const file = join(d, "secrets.json");
    const localKeyFile = join(d, "secret-key");
    new SecretStore({ file, safeStorage: fakeSafeStorage(), platform: "darwin", localKeyFile }).set(
      "A_KEY",
      "1",
    );
    const other = join(d, "another-key");
    const s = new SecretStore({
      file,
      safeStorage: fakeSafeStorage(),
      platform: "darwin",
      localKeyFile: other,
    });
    expect(s.has("A_KEY")).toBe(false);
  });
});
