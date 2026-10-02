// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { resolveWindowsCommand, shimScript, type WindowsCommandHost } from "./windows-command.ts";

const NPM = "C:\\Users\\rami\\AppData\\Roaming\\npm";
const SHIM = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`;

function host(files: string[], env: Record<string, string> = {}): WindowsCommandHost {
  const set = new Set(files.map((f) => f.toLowerCase()));
  return {
    env: { Path: `C:\\Windows\\System32;${NPM};C:\\Program Files\\nodejs`, ...env },
    isFile: (p) => set.has(p.toLowerCase()),
    readText: (p) => (p.toLowerCase() === `${NPM}\\codex.cmd`.toLowerCase() ? SHIM : undefined),
  };
}

describe("resolveWindowsCommand", () => {
  it("leaves paths and names with an extension alone", () => {
    const h = host([]);
    expect(resolveWindowsCommand("C:\\tools\\codex.exe", h)).toEqual({
      file: "C:\\tools\\codex.exe",
      prefixArgs: [],
    });
    expect(resolveWindowsCommand("codex.cmd", h)).toEqual({ file: "codex.cmd", prefixArgs: [] });
  });

  it("prefers a native .exe on PATH (case-insensitive Path variable)", () => {
    const h = host([`${NPM}\\codex.cmd`, "C:\\Program Files\\nodejs\\codex.exe"]);
    expect(resolveWindowsCommand("codex", h)).toEqual({
      file: "C:\\Program Files\\nodejs\\codex.exe",
      prefixArgs: [],
    });
  });

  it("turns an npm .cmd shim into node plus the script it launches, without a shell", () => {
    const script = `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`;
    const h = host([`${NPM}\\codex.cmd`, script, "C:\\Program Files\\nodejs\\node.exe"]);
    expect(resolveWindowsCommand("codex", h)).toEqual({
      file: "C:\\Program Files\\nodejs\\node.exe",
      prefixArgs: [script],
    });
  });

  it("uses the node.exe next to the shim when there is one", () => {
    const script = `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`;
    const h = host([`${NPM}\\codex.cmd`, script, `${NPM}\\node.exe`, "C:\\Program Files\\nodejs\\node.exe"]);
    expect(resolveWindowsCommand("codex", h).file).toBe(`${NPM}\\node.exe`);
  });

  it("stays unresolved when the shim's script or node is missing, so spawn reports ENOENT as before", () => {
    expect(resolveWindowsCommand("codex", host([`${NPM}\\codex.cmd`])).file).toBe("codex");
    const script = `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`;
    expect(resolveWindowsCommand("codex", host([`${NPM}\\codex.cmd`, script])).file).toBe("codex");
    expect(resolveWindowsCommand("codex", host([])).file).toBe("codex");
  });

  it("reads the script path out of both npm shim shapes", () => {
    expect(shimScript(`${NPM}\\codex.cmd`, SHIM)).toBe(`${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`);
    expect(shimScript(`${NPM}\\x.cmd`, 'node  "%~dp0\\node_modules\\x\\cli.mjs" %*')).toBe(
      `${NPM}\\node_modules\\x\\cli.mjs`,
    );
    expect(shimScript(`${NPM}\\x.cmd`, "@echo off\r\nsomething-else.exe %*")).toBeUndefined();
  });
});
