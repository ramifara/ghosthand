// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Windows: `spawn("codex")` without a shell only finds `codex.exe`, never the `codex.cmd` shim npm puts on
// PATH, so the Codex and Claude CLIs looked "not installed" there. This resolves a bare command name the
// way a shell would (PATH + PATHEXT) and, for an npm `.cmd` shim, runs the JavaScript entry it points at
// with node directly. No shell is ever involved, so arguments (system prompts with quotes, `%`, `&`)
// pass through untouched.
import { win32 } from "node:path";

export interface WindowsCommandHost {
  readonly env: Readonly<Record<string, string | undefined>>;
  isFile(path: string): boolean;
  /** Text of a small file, or undefined when it cannot be read. */
  readText(path: string): string | undefined;
}

export interface ResolvedCommand {
  readonly file: string;
  /** Arguments to put before the caller's own (the shim's script for a node launcher). */
  readonly prefixArgs: readonly string[];
}

function envValue(env: WindowsCommandHost["env"], name: string): string | undefined {
  const upper = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === upper && value !== undefined && value !== "") return value;
  }
  return undefined;
}

function pathDirs(env: WindowsCommandHost["env"]): string[] {
  return (envValue(env, "PATH") ?? "").split(win32.delimiter).filter((dir) => dir !== "");
}

/** First `<dir>\<command><ext>` on PATH for the given extensions, in PATH order then extension order. */
function findOnPath(command: string, exts: readonly string[], host: WindowsCommandHost): string | undefined {
  for (const dir of pathDirs(host.env)) {
    for (const ext of exts) {
      const candidate = win32.join(dir, `${command}${ext}`);
      if (host.isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * The script an npm `.cmd` shim launches, e.g. `"%dp0%\node_modules\@openai\codex\bin\codex.js"`.
 * Returns an absolute path or undefined when the shim is not in that shape.
 */
export function shimScript(shimPath: string, shimText: string): string | undefined {
  // `%dp0%` (npm's SET dp0=%~dp0 form) or the bare `%~dp0` batch variable.
  const m =
    /"%(?:~dp0|dp0%)\\([^"]+\.[cm]?js)"/i.exec(shimText) ?? /%(?:~dp0|dp0%)\\(\S+\.[cm]?js)/i.exec(shimText);
  if (!m?.[1]) return undefined;
  return win32.join(win32.dirname(shimPath), m[1]);
}

/**
 * Resolves `command` for a shell-less spawn on Windows. A name with a path separator or an extension is
 * taken as is. Otherwise: a native `.exe`/`.com` on PATH wins; an npm `.cmd` shim becomes
 * `node <script>` when its script and a `node.exe` exist; anything else stays unresolved (spawn then
 * reports ENOENT as before).
 */
export function resolveWindowsCommand(command: string, host: WindowsCommandHost): ResolvedCommand {
  const asIs: ResolvedCommand = { file: command, prefixArgs: [] };
  if (/[\\/]/.test(command) || win32.extname(command) !== "") return asIs;
  const native = findOnPath(command, [".exe", ".com"], host);
  if (native !== undefined) return { file: native, prefixArgs: [] };
  const shim = findOnPath(command, [".cmd", ".bat"], host);
  if (shim === undefined) return asIs;
  const text = host.readText(shim);
  const script = text === undefined ? undefined : shimScript(shim, text);
  if (script === undefined || !host.isFile(script)) return asIs;
  // npm shims prefer the node next to them, then PATH.
  const sibling = win32.join(win32.dirname(shim), "node.exe");
  const node = host.isFile(sibling) ? sibling : findOnPath("node", [".exe"], host);
  if (node === undefined) return asIs;
  return { file: node, prefixArgs: [script] };
}
