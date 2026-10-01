// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Detects a Chromium user-data-dir that a running browser holds.
// Linux/macOS: `SingletonLock` is a symlink to `<hostname>-<pid>` (and `SingletonSocket` to a live socket).
// Windows: the browser keeps `lockfile` open without sharing, so opening it fails while it runs.

import { closeSync, existsSync, lstatSync, openSync, readlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import type { HostPlatform } from "./host.ts";
import { toHostPlatform } from "./host.ts";

export interface LockProbe {
  readonly platform: HostPlatform;
  readonly hostname: string;
  isPidAlive(pid: number): boolean;
  /** Windows: true when `path` exists and another process holds it open exclusively. */
  isFileHeldOpen(path: string): boolean;
}

export interface LiveLock {
  readonly userDataDir: string;
  readonly reason: string;
  readonly pid?: number;
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export function nodeLockProbe(): LockProbe {
  return {
    platform: toHostPlatform(process.platform),
    hostname: hostname(),
    isPidAlive(pid: number): boolean {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        // EPERM: the process exists but belongs to someone else.
        return errnoCode(error) === "EPERM";
      }
    },
    isFileHeldOpen(path: string): boolean {
      if (!existsSync(path)) return false;
      try {
        closeSync(openSync(path, "r+"));
        return false;
      } catch (error) {
        const code = errnoCode(error);
        return code === "EBUSY" || code === "EPERM" || code === "EACCES";
      }
    },
  };
}

/** Parses a `SingletonLock` target such as `my-host-12345` (hostnames may contain dashes). */
export function parseSingletonLockTarget(target: string): { host: string; pid: number } | undefined {
  const dash = target.lastIndexOf("-");
  if (dash <= 0) return undefined;
  const pid = Number(target.slice(dash + 1));
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  return { host: target.slice(0, dash), pid };
}

function readLink(path: string): { kind: "missing" } | { kind: "link"; target: string } | { kind: "other" } {
  try {
    const stat = lstatSync(path);
    if (!stat.isSymbolicLink()) return { kind: "other" };
    return { kind: "link", target: readlinkSync(path) };
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return { kind: "missing" };
    return { kind: "other" };
  }
}

/** Returns the live lock on `userDataDir`, or `undefined` when no running browser holds it (stale locks are ignored). */
export function findLiveLock(userDataDir: string, probe: LockProbe = nodeLockProbe()): LiveLock | undefined {
  if (probe.platform === "win32") {
    return probe.isFileHeldOpen(join(userDataDir, "lockfile"))
      ? { userDataDir, reason: "lockfile is held open by a running browser" }
      : undefined;
  }
  const lock = readLink(join(userDataDir, "SingletonLock"));
  if (lock.kind === "link") {
    const parsed = parseSingletonLockTarget(lock.target);
    if (parsed === undefined)
      return { userDataDir, reason: `SingletonLock has an unexpected target "${lock.target}"` };
    if (parsed.host !== probe.hostname) {
      return { userDataDir, pid: parsed.pid, reason: `SingletonLock is held by host "${parsed.host}"` };
    }
    if (probe.isPidAlive(parsed.pid)) {
      return {
        userDataDir,
        pid: parsed.pid,
        reason: `SingletonLock is held by running process ${parsed.pid}`,
      };
    }
    return undefined;
  }
  if (lock.kind === "other") return { userDataDir, reason: "SingletonLock exists and is not a symlink" };
  // No SingletonLock: a SingletonSocket whose target still exists means a browser is serving it.
  const socket = readLink(join(userDataDir, "SingletonSocket"));
  if (socket.kind === "link" && existsSync(socket.target)) {
    return { userDataDir, reason: "SingletonSocket points at a live socket" };
  }
  return undefined;
}
