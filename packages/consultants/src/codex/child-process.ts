// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The slice of `node:child_process` the CLI consultants (Codex, Claude) use, so tests can inject a fake process.
import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
import type { ConsultantError, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import { resolveWindowsCommand, type WindowsCommandHost } from "./windows-command.ts";

export interface ChildProcessLike {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "spawn", listener: () => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  off(event: "spawn", listener: () => void): this;
  off(event: "error", listener: (error: Error) => void): this;
}

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcessLike;

const windowsHost = (env: NodeJS.ProcessEnv): WindowsCommandHost => ({
  env,
  isFile(path) {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  readText(path) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
});

export const defaultSpawn: SpawnFn = (command, args, options) => {
  // Windows finds `codex.exe` but not the `codex.cmd` shim npm installs; resolve it without a shell.
  const resolved =
    process.platform === "win32"
      ? resolveWindowsCommand(command, windowsHost(options.env ?? process.env))
      : { file: command, prefixArgs: [] };
  return nodeSpawn(resolved.file, [...resolved.prefixArgs, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
};

function errorCode(e: Error): string | undefined {
  const code: unknown = Reflect.get(e, "code");
  return typeof code === "string" ? code : undefined;
}

/** Maps a spawn failure: a missing or non-executable binary is `not_installed`, anything else is `process`. */
export function spawnFailure(binary: string, e: Error): ConsultantError {
  const code = errorCode(e);
  if (code === "ENOENT" || code === "EACCES" || code === "ENOTDIR") {
    return {
      kind: "not_installed",
      message: `"${binary}" was not found or is not executable (${code})`,
    };
  }
  return { kind: "process", message: `failed to start ${binary}: ${e.message}` };
}

/** Spawns and waits for the `spawn` (or `error`) event so a missing binary surfaces as a Result. */
export function startProcess(
  spawn: SpawnFn,
  binary: string,
  args: readonly string[],
  options: SpawnOptions,
): Promise<Result<ChildProcessLike, ConsultantError>> {
  let child: ChildProcessLike;
  try {
    child = spawn(binary, args, options);
  } catch (e) {
    return Promise.resolve(err(spawnFailure(binary, e instanceof Error ? e : new Error(String(e)))));
  }
  return new Promise((resolve) => {
    const onSpawn = (): void => {
      child.off("error", onError);
      // Keep a listener so a later 'error' (e.g. EPIPE on kill) never becomes an uncaught exception.
      child.on("error", () => {});
      resolve(ok(child));
    };
    const onError = (e: Error): void => {
      child.off("spawn", onSpawn);
      resolve(err(spawnFailure(binary, e)));
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

/** Keeps the last `max` characters written to stderr, for error messages. */
export function collectTail(stream: Readable | null, max = 2000): () => string {
  let tail = "";
  stream?.setEncoding("utf8");
  stream?.on("data", (chunk: string) => {
    tail = (tail + chunk).slice(-max);
  });
  return () => tail.trim();
}

/** Ends stdin, waits up to `graceMs` for exit, then sends SIGTERM (and SIGKILL after another grace period). */
export async function stopProcess(child: ChildProcessLike, graceMs = 1000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const wait = (ms: number): Promise<boolean> =>
    Promise.race([
      exited.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), ms).unref()),
    ]);
  child.stdin?.end();
  if (await wait(graceMs)) return;
  child.kill("SIGTERM");
  if (await wait(graceMs)) return;
  child.kill("SIGKILL");
}
