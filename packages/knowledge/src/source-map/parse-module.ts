// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Parses TS/TSX/JS/JSX into a Babel AST. Wraps parser exceptions into a Result.
import { parse } from "@babel/parser";
import type { File } from "@babel/types";
import { err, ok, type Result } from "@ghosthand/protocol";

export type ParseFailure = { kind: "parse"; file: string; message: string };

export function parseModule(code: string, file: string): Result<File, ParseFailure> {
  // Angle-bracket casts in .ts conflict with JSX, so only enable JSX where it can appear.
  const jsx = !file.endsWith(".ts") && !file.endsWith(".mts") && !file.endsWith(".cts");
  try {
    const ast = parse(code, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      errorRecovery: true,
      plugins: jsx ? ["typescript", "jsx"] : ["typescript"],
    });
    return ok(ast);
  } catch (e) {
    return err({ kind: "parse", file, message: e instanceof Error ? e.message : String(e) });
  }
}
