// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { profileCreateCommand, profileListCommand } from "./profile-commands.ts";
import type { ProfileStore } from "./profile-store.ts";
import { openProfileStore } from "./profile-store.ts";

describe("profile store", () => {
  let root: string;
  let store: ProfileStore;
  beforeEach(() => {
    root = join(mkdtempSync(join(tmpdir(), "ghosthand-store-")), "profiles");
    store = openProfileStore({ root });
  });
  afterEach(() => {
    rmSync(join(root, ".."), { recursive: true, force: true });
  });

  it("lists nothing before the root exists", async () => {
    expect(await store.list()).toEqual({ ok: true, value: [] });
  });

  it("creates, resolves, lists and removes a profile", async () => {
    const created = await store.create("work");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.dir).toBe(join(root, "work"));
    expect(created.value.metadata?.passwordStore).toBe("basic");

    const again = await store.create("work");
    expect(!again.ok && again.error.kind).toBe("profile_exists");

    const resolved = await store.resolve("work");
    expect(resolved.ok && resolved.value.metadata?.name).toBe("work");

    writeFileSync(join(created.value.dir, "data.bin"), Buffer.alloc(1000));
    await store.markUsed(created.value, new Date("2026-10-01T10:00:00.000Z"));
    // Stray directories (interrupted imports, invalid names) are not profiles.
    mkdirSync(join(root, ".import-x-1-2"));
    mkdirSync(join(root, "Not A Profile"));

    const listed = await store.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((p) => p.name)).toEqual(["work"]);
    expect(listed.value[0]?.lastUsedAt).toBe("2026-10-01T10:00:00.000Z");
    expect(listed.value[0]?.sizeBytes).toBeGreaterThan(1000);

    expect((await store.remove("work")).ok).toBe(true);
    expect(existsSync(created.value.dir)).toBe(false);
    const gone = await store.resolve("work");
    expect(!gone.ok && gone.error.kind).toBe("profile_not_found");
  });

  it("validates names on every entry point", async () => {
    for (const result of [await store.create("../x"), await store.resolve("A"), await store.remove("a b")]) {
      expect(!result.ok && result.error.kind).toBe("invalid_name");
    }
  });

  it("ensure creates a missing profile once", async () => {
    const first = await store.ensure("default");
    const second = await store.ensure("default");
    expect(first.ok && second.ok && first.value.dir === second.value.dir).toBe(true);
  });

  it.skipIf(process.platform === "win32")("refuses to remove a profile a browser holds", async () => {
    const created = await store.create("busy");
    if (!created.ok) throw new Error("create failed");
    symlinkSync(`${hostname()}-${process.pid}`, join(created.value.dir, "SingletonLock"));
    const removed = await store.remove("busy");
    expect(!removed.ok && removed.error.kind).toBe("profile_locked");
  });

  it("formats create and list command output", async () => {
    const created = await profileCreateCommand("acme-staging", { store });
    expect(created.ok && created.value.text).toContain('Created profile "acme-staging"');
    const listed = await profileListCommand({ store });
    expect(listed.ok && listed.value.text).toMatch(/acme-staging\s+\d+(\.\d)? (B|KB)\s+last used never/);
  });
});
