#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { parseArgs } from "node:util";
import { browsersCommand, profileCommand } from "./commands/profile.ts";
import { runsCommand } from "./commands/runs.ts";
import { fail, out } from "./io.ts";

export const HELP = `ghosthand, a Jev CUA

Usage:
  ghosthand run --url <url> (--task <id> | "<goal>") [--profile <name>] [--allow-origin <origin>]... [--headless]
  ghosthand replay <runId> [--headless]
  ghosthand runs list [--limit N] [--task <id>]
  ghosthand doctor
  ghosthand profile create <name> | list | import <chrome-profile-dir> <name> | remove <name>
  ghosthand browsers
  ghosthand tasks

Options:
  --json        machine-readable output
  --config      path to ghosthand.config.ts
  -h, --help    show this help
`;

export async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 2);
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    out(HELP);
    return command ? 0 : values.help ? 0 : 2;
  }
  const json = values.json ?? false;
  switch (command) {
    case "runs":
      return runsCommand(rest, {
        json,
        ...(values.limit ? { limit: values.limit } : {}),
        ...(values.task ? { task: values.task } : {}),
      });
    case "profile":
      return profileCommand(rest, json);
    case "browsers":
      return browsersCommand(json);
    default:
      return fail(`unknown command "${command}"\n\n${HELP}`, 2);
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      task: { type: "string" },
      profile: { type: "string" },
      "allow-origin": { type: "string", multiple: true },
      headless: { type: "boolean" },
      json: { type: "boolean" },
      limit: { type: "string" },
      config: { type: "string" },
      "no-trace": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.exitCode = fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
    },
  );
}
