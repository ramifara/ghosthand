// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Named GhostHand browser profiles. Each profile directory is a Chromium user-data-dir
// (`<root>/<name>/Default/...`) that `launchPersistentContext` opens directly.

import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { BrowserHost } from "./host.ts";
import { nodeBrowserHost } from "./host.ts";
import type { ProfileError } from "./profile-error.ts";
import { ioError, profileError } from "./profile-error.ts";
import type { LockProbe } from "./profile-lock.ts";
import { findLiveLock, nodeLockProbe } from "./profile-lock.ts";
import type { PasswordStore, ProfileMetadata } from "./profile-metadata.ts";
import { readProfileMetadata, writeProfileMetadata } from "./profile-metadata.ts";
import { validateProfileName } from "./profile-name.ts";
import { defaultProfilesRoot } from "./profile-paths.ts";

export interface ResolvedProfile {
  readonly name: string;
  /** The Chromium user-data-dir. */
  readonly dir: string;
  readonly metadata?: ProfileMetadata;
}

export interface ProfileSummary extends ResolvedProfile {
  readonly sizeBytes: number;
  /** ISO timestamp of the last launch, if any. */
  readonly lastUsedAt?: string;
}

export interface CreateProfileOptions {
  readonly passwordStore?: PasswordStore;
  readonly importedFrom?: string;
}

export interface ProfileStore {
  readonly root: string;
  readonly lockProbe: LockProbe;
  create(name: string, options?: CreateProfileOptions): Promise<Result<ResolvedProfile, ProfileError>>;
  list(): Promise<Result<readonly ProfileSummary[], ProfileError>>;
  /** Deletes a profile; refuses while a browser is using it. */
  remove(name: string): Promise<Result<void, ProfileError>>;
  resolve(name: string): Promise<Result<ResolvedProfile, ProfileError>>;
  /** Resolves `name`, creating it first when it does not exist. */
  ensure(name: string): Promise<Result<ResolvedProfile, ProfileError>>;
  /** Records a launch in the profile's metadata. */
  markUsed(profile: ResolvedProfile, when?: Date): Promise<Result<void, ProfileError>>;
}

export interface ProfileStoreOptions {
  /** Store root; defaults to the platform's app-data location (see `defaultProfilesRoot`). */
  readonly root?: string;
  readonly host?: BrowserHost;
  readonly lockProbe?: LockProbe;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** Total size of regular files under `dir` (symlinks are not followed). */
export async function directorySize(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      total += (await lstat(join(entry.parentPath, entry.name))).size;
    } catch {
      // Removed while we were walking.
    }
  }
  return total;
}

export function openProfileStore(options: ProfileStoreOptions = {}): ProfileStore {
  const root = options.root ?? defaultProfilesRoot(options.host ?? nodeBrowserHost());
  const lockProbe = options.lockProbe ?? nodeLockProbe();

  async function resolve(name: string): Promise<Result<ResolvedProfile, ProfileError>> {
    const valid = validateProfileName(name);
    if (!valid.ok) return valid;
    const dir = join(root, name);
    try {
      const stat = await lstat(dir);
      if (!stat.isDirectory()) return err(profileError("io", `Profile path ${dir} is not a directory`));
    } catch (error) {
      if (isNotFound(error)) {
        return err(profileError("profile_not_found", `No profile named "${name}" in ${root}`));
      }
      return err(ioError(`Reading profile ${dir}`, error));
    }
    const metadata = await readProfileMetadata(dir);
    return ok({ name, dir, ...(metadata !== undefined ? { metadata } : {}) });
  }

  async function create(name: string, createOptions: CreateProfileOptions = {}) {
    const valid = validateProfileName(name);
    if (!valid.ok) return valid;
    const dir = join(root, name);
    try {
      await mkdir(root, { recursive: true, mode: 0o700 });
      await mkdir(dir, { mode: 0o700 });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
        return err(profileError("profile_exists", `A profile named "${name}" already exists in ${root}`));
      }
      return err(ioError(`Creating profile ${dir}`, error));
    }
    const metadata: ProfileMetadata = {
      version: 1,
      name,
      createdAt: new Date().toISOString(),
      passwordStore: createOptions.passwordStore ?? "basic",
      ...(createOptions.importedFrom !== undefined ? { importedFrom: createOptions.importedFrom } : {}),
    };
    try {
      await writeProfileMetadata(dir, metadata);
    } catch (error) {
      return err(ioError(`Writing profile metadata in ${dir}`, error));
    }
    return ok<ResolvedProfile>({ name, dir, metadata });
  }

  async function list(): Promise<Result<readonly ProfileSummary[], ProfileError>> {
    let names: string[];
    try {
      const entries = await readdir(root, { withFileTypes: true });
      // Staging directories from an interrupted import start with "." and fail validation.
      names = entries
        .filter((entry) => entry.isDirectory() && validateProfileName(entry.name).ok)
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isNotFound(error)) return ok([]);
      return err(ioError(`Listing profiles in ${root}`, error));
    }
    const summaries: ProfileSummary[] = [];
    for (const name of names) {
      const resolved = await resolve(name);
      if (!resolved.ok) continue;
      let sizeBytes: number;
      try {
        sizeBytes = await directorySize(resolved.value.dir);
      } catch (error) {
        return err(ioError(`Measuring profile ${resolved.value.dir}`, error));
      }
      const lastUsedAt = resolved.value.metadata?.lastUsedAt;
      summaries.push({ ...resolved.value, sizeBytes, ...(lastUsedAt !== undefined ? { lastUsedAt } : {}) });
    }
    return ok(summaries);
  }

  async function remove(name: string): Promise<Result<void, ProfileError>> {
    const resolved = await resolve(name);
    if (!resolved.ok) return resolved;
    const lock = findLiveLock(resolved.value.dir, lockProbe);
    if (lock !== undefined) {
      return err(
        profileError("profile_locked", `Profile "${name}" is in use (${lock.reason}); close it first.`),
      );
    }
    try {
      await rm(resolved.value.dir, { recursive: true, force: true });
    } catch (error) {
      return err(ioError(`Removing profile ${resolved.value.dir}`, error));
    }
    return ok(undefined);
  }

  async function ensure(name: string): Promise<Result<ResolvedProfile, ProfileError>> {
    const resolved = await resolve(name);
    if (resolved.ok || resolved.error.kind !== "profile_not_found") return resolved;
    const created = await create(name);
    // Another process may have created it in between.
    if (!created.ok && created.error.kind === "profile_exists") return resolve(name);
    return created;
  }

  async function markUsed(profile: ResolvedProfile, when: Date = new Date()) {
    const base: ProfileMetadata = profile.metadata ?? {
      version: 1,
      name: profile.name,
      createdAt: when.toISOString(),
      passwordStore: "basic",
    };
    try {
      await writeProfileMetadata(profile.dir, { ...base, lastUsedAt: when.toISOString() });
    } catch (error) {
      return err(ioError(`Updating profile metadata in ${profile.dir}`, error));
    }
    return ok(undefined);
  }

  return { root, lockProbe, create, list, remove, resolve, ensure, markUsed };
}
