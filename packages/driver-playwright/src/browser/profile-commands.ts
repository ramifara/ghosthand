// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Functions behind `ghosthand profile create|list|import|remove` and `ghosthand browsers`.
// They return data plus a human-readable line; apps/cli does the argument parsing and printing.

import type { Result } from "@ghosthand/protocol";
import { ok } from "@ghosthand/protocol";
import type { InstalledBrowser } from "./detect-browsers.ts";
import { detectBrowsers } from "./detect-browsers.ts";
import type { BrowserHost } from "./host.ts";
import { nodeBrowserHost } from "./host.ts";
import type { ImportedProfile } from "./import-chrome-profile.ts";
import { importChromeProfile } from "./import-chrome-profile.ts";
import type { ProfileError } from "./profile-error.ts";
import type { ProfileStore, ProfileSummary, ResolvedProfile } from "./profile-store.ts";
import { openProfileStore } from "./profile-store.ts";

export interface CommandOutput<T> {
  readonly data: T;
  readonly text: string;
}

export interface ProfileCommandOptions {
  readonly store?: ProfileStore;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} ${units[0]}` : `${value.toFixed(1)} ${units[unit]}`;
}

export function formatProfileList(profiles: readonly ProfileSummary[], root: string): string {
  if (profiles.length === 0)
    return `No profiles in ${root}. Create one with: ghosthand profile create <name>`;
  const rows = profiles.map((profile) => {
    const used = profile.lastUsedAt ?? "never";
    const source =
      profile.metadata?.importedFrom !== undefined ? `  imported from ${profile.metadata.importedFrom}` : "";
    return `${profile.name.padEnd(24)} ${formatBytes(profile.sizeBytes).padStart(10)}  last used ${used}${source}`;
  });
  return [`Profiles in ${root}:`, ...rows].join("\n");
}

export async function profileCreateCommand(
  name: string,
  options: ProfileCommandOptions = {},
): Promise<Result<CommandOutput<ResolvedProfile>, ProfileError>> {
  const store = options.store ?? openProfileStore();
  const created = await store.create(name);
  if (!created.ok) return created;
  return ok({ data: created.value, text: `Created profile "${name}" at ${created.value.dir}` });
}

export async function profileListCommand(
  options: ProfileCommandOptions = {},
): Promise<Result<CommandOutput<readonly ProfileSummary[]>, ProfileError>> {
  const store = options.store ?? openProfileStore();
  const listed = await store.list();
  if (!listed.ok) return listed;
  return ok({ data: listed.value, text: formatProfileList(listed.value, store.root) });
}

export async function profileImportCommand(
  sourceProfileDir: string,
  name: string,
  options: ProfileCommandOptions = {},
): Promise<Result<CommandOutput<ImportedProfile>, ProfileError>> {
  const store = options.store ?? openProfileStore();
  const imported = await importChromeProfile(sourceProfileDir, name, { store });
  if (!imported.ok) return imported;
  const { files, bytes, dir } = imported.value;
  return ok({
    data: imported.value,
    text:
      `Imported ${files} files (${formatBytes(bytes)}) into profile "${name}" at ${dir}.\n` +
      "Cookies stay encrypted with this machine's keyring, so the profile only works for this user on this machine.",
  });
}

export async function profileRemoveCommand(
  name: string,
  options: ProfileCommandOptions = {},
): Promise<Result<CommandOutput<{ name: string }>, ProfileError>> {
  const store = options.store ?? openProfileStore();
  const removed = await store.remove(name);
  if (!removed.ok) return removed;
  return ok({ data: { name }, text: `Removed profile "${name}"` });
}

export async function browsersListCommand(
  host: BrowserHost = nodeBrowserHost(),
): Promise<CommandOutput<readonly InstalledBrowser[]>> {
  const browsers = await detectBrowsers(host, { withVersion: true });
  const text =
    browsers.length === 0
      ? "No Chrome, Edge or Brave found; GhostHand will use Playwright's Chromium if it is downloaded."
      : browsers
          .map((b) => `${b.kind.padEnd(7)} ${(b.version ?? "unknown").padEnd(16)} ${b.executablePath}`)
          .join("\n");
  return { data: browsers, text };
}
