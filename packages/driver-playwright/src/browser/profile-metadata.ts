// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand-profile.json`, written at the top of each profile's user-data-dir.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PROFILE_METADATA_FILE = "ghosthand-profile.json";

/**
 * How Chromium encrypts cookies and passwords in this profile.
 * `basic`: Playwright's default (`--password-store=basic`, `--use-mock-keychain`), portable but weakly protected.
 * `os`: the OS keyring / Keychain / DPAPI, required to read cookies imported from a real Chrome profile.
 */
export type PasswordStore = "basic" | "os";

export interface ProfileMetadata {
  readonly version: 1;
  readonly name: string;
  readonly createdAt: string;
  readonly lastUsedAt?: string;
  /** Source profile directory when the profile was imported. */
  readonly importedFrom?: string;
  readonly passwordStore: PasswordStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses metadata; returns `undefined` for anything malformed (the profile still works, it just lacks details). */
export function parseProfileMetadata(value: unknown): ProfileMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const { version, name, createdAt, lastUsedAt, importedFrom, passwordStore } = value;
  if (version !== 1 || typeof name !== "string" || typeof createdAt !== "string") return undefined;
  if (passwordStore !== "basic" && passwordStore !== "os") return undefined;
  return {
    version,
    name,
    createdAt,
    passwordStore,
    ...(typeof lastUsedAt === "string" ? { lastUsedAt } : {}),
    ...(typeof importedFrom === "string" ? { importedFrom } : {}),
  };
}

export async function readProfileMetadata(dir: string): Promise<ProfileMetadata | undefined> {
  try {
    const text = await readFile(join(dir, PROFILE_METADATA_FILE), "utf8");
    return parseProfileMetadata(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export async function writeProfileMetadata(dir: string, metadata: ProfileMetadata): Promise<void> {
  await writeFile(join(dir, PROFILE_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600,
  });
}
