// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importChromeProfile, shouldCopyProfileEntry } from "./import-chrome-profile.ts";
import { profileImportCommand } from "./profile-commands.ts";
import type { ProfileStore } from "./profile-store.ts";
import { openProfileStore } from "./profile-store.ts";

function write(path: string, content = "x"): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("shouldCopyProfileEntry", () => {
  it.each([
    "Cookies",
    "Preferences",
    "Local Storage/leveldb/000003.log",
    "IndexedDB/https_example.com_0.indexeddb.leveldb/LOG",
    "Extensions/abc/1.0/manifest.json",
    "Service Worker/Database/LOG",
    "Network/Cookies",
    "Login Data",
  ])("copies %s", (path) => {
    expect(shouldCopyProfileEntry(path)).toBe(true);
  });

  it.each([
    "Cache",
    "Cache/Cache_Data/data_0",
    "Code Cache/js/index",
    "GPUCache",
    "DawnGraphiteCache/data_0",
    "Service Worker/CacheStorage",
    "Service Worker\\CacheStorage\\abc",
    "Service Worker/ScriptCache/x",
    "SingletonLock",
    "lockfile",
  ])("skips %s", (path) => {
    expect(shouldCopyProfileEntry(path)).toBe(false);
  });
});

describe("importChromeProfile", () => {
  let tmp: string;
  let store: ProfileStore;
  let userDataDir: string;
  let profileDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghosthand-import-"));
    store = openProfileStore({ root: join(tmp, "profiles") });
    userDataDir = join(tmp, "chrome");
    profileDir = join(userDataDir, "Profile 1");
    write(join(userDataDir, "Local State"), '{"os_crypt":{}}');
    write(join(profileDir, "Preferences"), "{}");
    write(join(profileDir, "Cookies"), "cookie-db");
    write(join(profileDir, "Local Storage/leveldb/000003.log"), "ls");
    write(join(profileDir, "IndexedDB/https_a.test_0.indexeddb.leveldb/CURRENT"), "idb");
    write(join(profileDir, "Extensions/abc/1.0/manifest.json"), "{}");
    write(join(profileDir, "Cache/Cache_Data/data_0"), "cache");
    write(join(profileDir, "Code Cache/js/index"), "cache");
    write(join(profileDir, "GPUCache/data_0"), "cache");
    write(join(profileDir, "Service Worker/CacheStorage/x/index"), "cache");
    write(join(profileDir, "Service Worker/Database/LOG"), "sw");
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("copies the profile into <name>/Default with Local State and without caches", async () => {
    const result = await importChromeProfile(profileDir, "imported", { store });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dir = result.value.dir;
    expect(dir).toBe(join(tmp, "profiles", "imported"));
    expect(readFileSync(join(dir, "Default", "Cookies"), "utf8")).toBe("cookie-db");
    expect(readFileSync(join(dir, "Local State"), "utf8")).toContain("os_crypt");
    for (const kept of [
      "Local Storage/leveldb/000003.log",
      "IndexedDB/https_a.test_0.indexeddb.leveldb/CURRENT",
      "Extensions/abc/1.0/manifest.json",
      "Service Worker/Database/LOG",
    ]) {
      expect(existsSync(join(dir, "Default", kept))).toBe(true);
    }
    for (const skipped of ["Cache", "Code Cache", "GPUCache", "Service Worker/CacheStorage"]) {
      expect(existsSync(join(dir, "Default", skipped))).toBe(false);
    }
    expect(result.value.metadata?.passwordStore).toBe("os");
    expect(result.value.metadata?.importedFrom).toBe(profileDir);
    // No staging directories left behind.
    expect(readdirSync(join(tmp, "profiles"))).toEqual(["imported"]);
  });

  it("accepts a user-data-dir and imports its Default profile", async () => {
    write(join(userDataDir, "Default", "Preferences"), "{}");
    write(join(userDataDir, "Default", "Cookies"), "default-cookies");
    const result = await importChromeProfile(userDataDir, "from-root", { store });
    expect(result.ok && readFileSync(join(result.value.dir, "Default", "Cookies"), "utf8")).toBe(
      "default-cookies",
    );
  });

  it.skipIf(process.platform === "win32")("refuses a live profile", async () => {
    symlinkSync(`${hostname()}-${process.pid}`, join(userDataDir, "SingletonLock"));
    const result = await importChromeProfile(profileDir, "live", { store });
    expect(!result.ok && result.error.kind).toBe("profile_locked");
    expect(existsSync(join(tmp, "profiles", "live"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "accepts a profile with a stale lock and drops the lock",
    async () => {
      symlinkSync(`${hostname()}-2147483000`, join(userDataDir, "SingletonLock"));
      symlinkSync(`${hostname()}-2147483000`, join(profileDir, "SingletonLock"));
      const result = await importChromeProfile(profileDir, "stale", { store });
      expect(result.ok).toBe(true);
      expect(existsSync(join(tmp, "profiles", "stale", "Default", "SingletonLock"))).toBe(false);
    },
  );

  it("rejects a directory that is not a Chrome profile, a bad name and an existing profile", async () => {
    const notProfile = await importChromeProfile(join(tmp, "profiles"), "x", { store });
    expect(!notProfile.ok && notProfile.error.kind).toBe("invalid_source");
    const badName = await importChromeProfile(profileDir, "Bad Name", { store });
    expect(!badName.ok && badName.error.kind).toBe("invalid_name");
    await store.create("taken");
    const taken = await importChromeProfile(profileDir, "taken", { store });
    expect(!taken.ok && taken.error.kind).toBe("profile_exists");
  });

  it("profileImportCommand reports the copy and the same-machine caveat", async () => {
    const result = await profileImportCommand(profileDir, "cmd", { store });
    expect(result.ok && result.value.text).toContain("only works for this user on this machine");
  });
});
