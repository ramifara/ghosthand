// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Runs `git diff base...head` (execFile, no shell) and scopes it against a SourceMap.
import { execFile } from "node:child_process";
import { err, ok, type Result } from "@ghosthand/protocol";
import { type ChangedSurface, scopeDiff } from "./diff-scope.ts";
import type { SourceMap } from "./source-map-schema.ts";

export type GitDiffError =
  | { kind: "invalid-ref"; ref: string }
  | { kind: "git-failed"; args: string[]; message: string };

export type ExecFileFn = (file: string, args: string[], opts: { cwd: string }) => Promise<string>;

export interface GitDiffOptions {
  /** A directory inside the repo; normally the scanned root. */
  cwd: string;
  base: string;
  /** Default "HEAD". */
  head?: string;
  /** Injected for tests; defaults to node:child_process execFile. */
  exec?: ExecFileFn;
}

export type GitDiffText = { nameOnly: string; patch: string; pathPrefix: string };

const MAX_BUFFER = 64 * 1024 * 1024;

const defaultExec: ExecFileFn = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd: opts.cwd, maxBuffer: MAX_BUFFER, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve(stdout);
      },
    );
  });

// Refs never start with "-" (option injection) and stay within git's ref charset.
const SAFE_REF = /^[A-Za-z0-9_./~^@{}-]+$/;

export async function readGitDiff(opts: GitDiffOptions): Promise<Result<GitDiffText, GitDiffError>> {
  const head = opts.head ?? "HEAD";
  for (const ref of [opts.base, head]) {
    if (ref.startsWith("-") || !SAFE_REF.test(ref)) return err({ kind: "invalid-ref", ref });
  }
  const exec = opts.exec ?? defaultExec;
  const run = async (args: string[]): Promise<Result<string, GitDiffError>> => {
    try {
      return ok(await exec("git", args, { cwd: opts.cwd }));
    } catch (e) {
      return err({ kind: "git-failed", args, message: e instanceof Error ? e.message : String(e) });
    }
  };
  const range = `${opts.base}...${head}`;
  const prefix = await run(["rev-parse", "--show-prefix"]);
  if (!prefix.ok) return prefix;
  const common = ["diff", "--no-color", "--no-ext-diff", "--no-relative", "-M"];
  const nameOnly = await run([...common, "--name-only", range, "--"]);
  if (!nameOnly.ok) return nameOnly;
  const patch = await run([...common, "--unified=0", range, "--"]);
  if (!patch.ok) return patch;
  return ok({ nameOnly: nameOnly.value, patch: patch.value, pathPrefix: prefix.value.trim() });
}

/** `git diff base...head` scoped to the map's root. `cwd` should be the scanned root. */
export async function gitChangedSurface(
  map: SourceMap,
  opts: GitDiffOptions,
): Promise<Result<ChangedSurface, GitDiffError>> {
  const diff = await readGitDiff(opts);
  if (!diff.ok) return diff;
  return ok(scopeDiff(map, diff.value));
}
