// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Copies a Chrome profile into a new GhostHand profile. Chrome never shares a live profile, so a profile
// that a running browser holds is refused. Cookies are encrypted with the OS keyring (Linux), Keychain
// (macOS) or DPAPI plus `Local State` (Windows), so an import only works for the same user on the same machine.

import { copyFile, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { ProfileError } from "./profile-error.ts";
import { ioError, profileError } from "./profile-error.ts";
import { findLiveLock } from "./profile-lock.ts";
import type { ProfileMetadata } from "./profile-metadata.ts";
import { writeProfileMetadata } from "./profile-metadata.ts";
import { validateProfileName } from "./profile-name.ts";
import type { ProfileStore, ResolvedProfile } from "./profile-store.ts";
import { openProfileStore } from "./profile-store.ts";

/** Profile-relative directories that are caches or crash data, never copied. */
export const SKIPPED_PROFILE_DIRS: readonly string[] = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GraphiteDawnCache",
  "GrShaderCache",
  "ShaderCache",
  "Crashpad",
  "blob_storage",
  "Service Worker/CacheStorage",
  "Service Worker/ScriptCache",
];

/** File names that belong to a running browser instance, never copied. */
export const SKIPPED_PROFILE_FILES: readonly string[] = [
  "SingletonLock",
  "SingletonSocket",
  "SingletonCookie",
  "lockfile",
  "RunningChromeVersion",
];

/** Decides whether a profile-relative path (either separator) is copied. Skips caches and live-instance files. */
export function shouldCopyProfileEntry(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]+/).filter((part) => part !== "");
  if (parts.length === 0) return true;
  const name = parts[parts.length - 1] ?? "";
  if (SKIPPED_PROFILE_FILES.includes(name)) return false;
  for (const skipped of SKIPPED_PROFILE_DIRS) {
    const skipParts = skipped.split("/");
    if (skipParts.every((part, i) => parts[i] === part)) return false;
  }
  return true;
}

/**
 * Copies `source` to `destination`, keeping only regular files and directories that pass `filter`.
 * Symlinks, sockets and other special files are skipped.
 */
export async function copyProfileTree(
  source: string,
  destination: string,
  filter: (relativePath: string) => boolean = shouldCopyProfileEntry,
): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  async function walk(relative: string): Promise<void> {
    const from = join(source, relative);
    const to = join(destination, relative);
    await mkdir(to, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const rel = relative === "" ? entry.name : join(relative, entry.name);
      if (!filter(rel)) continue;
      if (entry.isDirectory()) {
        await walk(rel);
      } else if (entry.isFile()) {
        await copyFile(join(source, rel), join(destination, rel));
        files += 1;
        bytes += (await lstat(join(destination, rel))).size;
      }
    }
  }
  await walk("");
  return { files, bytes };
}

export interface ChromeProfileSource {
  /** The profile directory, e.g. `~/.config/google-chrome/Default` or `.../Profile 1`. */
  readonly profileDir: string;
  /** Its user-data-dir (holds `Local State` and the singleton locks), when recognisable. */
  readonly userDataDir?: string;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

/** Accepts either a profile dir (has `Preferences`) or a user-data-dir (has `Default/Preferences`). */
export async function locateChromeProfile(
  source: string,
): Promise<Result<ChromeProfileSource, ProfileError>> {
  const dir = resolvePath(source);
  try {
    if (!(await lstat(dir)).isDirectory()) {
      return err(profileError("invalid_source", `${dir} is not a directory`));
    }
  } catch {
    return err(profileError("invalid_source", `${dir} does not exist`));
  }
  if (await isFile(join(dir, "Preferences"))) {
    const parent = dirname(dir);
    return ok(
      (await isFile(join(parent, "Local State")))
        ? { profileDir: dir, userDataDir: parent }
        : { profileDir: dir },
    );
  }
  if (await isFile(join(dir, "Default", "Preferences"))) {
    return ok({ profileDir: join(dir, "Default"), userDataDir: dir });
  }
  return err(
    profileError(
      "invalid_source",
      `${dir} is not a Chrome profile (no Preferences file). Pass a profile directory such as ~/.config/google-chrome/Default.`,
    ),
  );
}

function checkNotLive(
  profileDir: string,
  dirs: readonly (string | undefined)[],
  store: ProfileStore,
): Result<void, ProfileError> {
  for (const dir of new Set(dirs)) {
    if (dir === undefined) continue;
    const lock = findLiveLock(dir, store.lockProbe);
    if (lock !== undefined) {
      return err(
        profileError(
          "profile_locked",
          `The Chrome profile at ${profileDir} is in use (${lock.reason}). Quit the browser and try again.`,
        ),
      );
    }
  }
  return ok(undefined);
}

/** Chrome keeps its singleton locks in the user-data-dir; check it, the profile dir and the profile's parent. */
function lockDirs(source: ChromeProfileSource): readonly (string | undefined)[] {
  return [source.userDataDir, source.profileDir, dirname(source.profileDir)];
}

export interface ImportOptions {
  readonly store?: ProfileStore;
}

export interface ImportedProfile extends ResolvedProfile {
  readonly files: number;
  readonly bytes: number;
}

/**
 * Copies `sourceProfileDir` into a new GhostHand profile `name`, laid out as `<profile>/Default`
 * with the source's `Local State` beside it. Refuses a profile a running browser holds (`profile_locked`).
 * The new profile uses the OS password store so Chrome can decrypt the copied cookies.
 */
export async function importChromeProfile(
  sourceProfileDir: string,
  name: string,
  options: ImportOptions = {},
): Promise<Result<ImportedProfile, ProfileError>> {
  const store = options.store ?? openProfileStore();
  const valid = validateProfileName(name);
  if (!valid.ok) return valid;
  const existing = await store.resolve(name);
  if (existing.ok) return err(profileError("profile_exists", `A profile named "${name}" already exists`));
  if (existing.error.kind !== "profile_not_found") return existing;

  // Check locks before inspecting the source: a profile a browser just created may not have Preferences yet.
  const sourceDir = resolvePath(sourceProfileDir);
  const early = checkNotLive(sourceDir, [sourceDir, dirname(sourceDir)], store);
  if (!early.ok) return early;
  const located = await locateChromeProfile(sourceDir);
  if (!located.ok) return located;
  const source = located.value;
  const before = checkNotLive(source.profileDir, lockDirs(source), store);
  if (!before.ok) return before;

  const dir = join(store.root, name);
  const staging = join(store.root, `.import-${name}-${process.pid}-${Date.now()}`);
  try {
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const copied = await copyProfileTree(source.profileDir, join(staging, "Default"));
    if (source.userDataDir !== undefined) {
      await copyFile(join(source.userDataDir, "Local State"), join(staging, "Local State"));
    }
    // A browser may have started while we copied; the copy would be torn.
    const after = checkNotLive(source.profileDir, lockDirs(source), store);
    if (!after.ok) {
      await rm(staging, { recursive: true, force: true });
      return after;
    }
    const metadata: ProfileMetadata = {
      version: 1,
      name,
      createdAt: new Date().toISOString(),
      importedFrom: source.profileDir,
      passwordStore: "os",
    };
    await writeProfileMetadata(staging, metadata);
    await rename(staging, dir);
    return ok({ name, dir, metadata, files: copied.files, bytes: copied.bytes });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    return err(ioError(`Importing ${basename(source.profileDir)} into ${dir}`, error));
  }
}
