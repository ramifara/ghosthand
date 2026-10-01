// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LockProbe } from "./profile-lock.ts";
import { findLiveLock, nodeLockProbe, parseSingletonLockTarget } from "./profile-lock.ts";

const DEAD_PID = 2_147_483_000;

describe("parseSingletonLockTarget", () => {
  it("splits host and pid at the last dash", () => {
    expect(parseSingletonLockTarget("my-host-name-4242")).toEqual({ host: "my-host-name", pid: 4242 });
    expect(parseSingletonLockTarget("nohyphen")).toBeUndefined();
    expect(parseSingletonLockTarget("host-abc")).toBeUndefined();
  });
});

describe.skipIf(process.platform === "win32")("findLiveLock (POSIX)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ghosthand-lock-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports no lock for an unlocked dir", () => {
    expect(findLiveLock(dir)).toBeUndefined();
  });

  it("detects a SingletonLock pointing at a live pid (this process)", () => {
    symlinkSync(`${hostname()}-${process.pid}`, join(dir, "SingletonLock"));
    expect(findLiveLock(dir)).toMatchObject({ pid: process.pid });
  });

  it("ignores a stale SingletonLock", () => {
    symlinkSync(`${hostname()}-${DEAD_PID}`, join(dir, "SingletonLock"));
    expect(findLiveLock(dir)).toBeUndefined();
  });

  it("treats a lock from another host as live", () => {
    symlinkSync(`some-other-host-${DEAD_PID}`, join(dir, "SingletonLock"));
    expect(findLiveLock(dir)?.reason).toContain("some-other-host");
  });

  it("uses SingletonSocket when SingletonLock is missing", () => {
    const socketTarget = join(dir, "fake-socket");
    writeFileSync(socketTarget, "");
    symlinkSync(socketTarget, join(dir, "SingletonSocket"));
    expect(findLiveLock(dir)?.reason).toContain("SingletonSocket");
    rmSync(socketTarget);
    expect(findLiveLock(dir)).toBeUndefined();
  });
});

describe("findLiveLock (Windows)", () => {
  it("asks whether lockfile is held open", () => {
    const held: string[] = [];
    const probe: LockProbe = {
      ...nodeLockProbe(),
      platform: "win32",
      isFileHeldOpen: (path) => {
        held.push(path);
        return true;
      },
    };
    expect(findLiveLock("C:\\profile", probe)?.reason).toContain("lockfile");
    expect(held[0]).toMatch(/lockfile$/);
    expect(findLiveLock("C:\\profile", { ...probe, isFileHeldOpen: () => false })).toBeUndefined();
  });
});
