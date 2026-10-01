// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Small, injectable system probes (which, run) so launchers and doctor checks are testable.
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SystemProbe {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  which(command: string): string | undefined;
  run(command: string, args: string[], opts?: { timeoutMs?: number; input?: string }): Promise<RunResult>;
}

export function whichSync(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (command.includes("/")) {
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      return undefined;
    }
  }
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, command + ext);
      try {
        accessSync(p, constants.X_OK);
        return p;
      } catch {
        // next
      }
    }
  }
  return undefined;
}

export function runCommand(
  command: string,
  args: string[],
  opts?: { timeoutMs?: number; input?: string; env?: NodeJS.ProcessEnv; cwd?: string },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        timeout: opts?.timeoutMs ?? 10_000,
        maxBuffer: 16 * 1024 * 1024,
        ...(opts?.env ? { env: opts.env } : {}),
        ...(opts?.cwd ? { cwd: opts.cwd } : {}),
      },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof (error as { code?: unknown }).code === "number"
              ? Number(error.code)
              : 1;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (opts?.input !== undefined) child.stdin?.end(opts.input);
  });
}

export const nodeSystem: SystemProbe = {
  platform: process.platform,
  env: process.env,
  which: (c) => whichSync(c),
  run: (c, a, o) => runCommand(c, a, o),
};

/** The driver-desktop package folder (hosts/, testbed/ live next to src/). */
export function packageRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}
