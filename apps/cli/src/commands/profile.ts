// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import {
  browsersListCommand,
  profileCreateCommand,
  profileImportCommand,
  profileListCommand,
  profileRemoveCommand,
} from "@ghosthand/driver-playwright";
import { fail, out } from "../io.ts";

const USAGE =
  "usage: ghosthand profile create <name> | list | import <chrome-profile-dir> <name> | remove <name>";

export async function profileCommand(args: string[], json: boolean): Promise<number> {
  const [sub, a, b] = args;
  const r =
    sub === "create" && a
      ? await profileCreateCommand(a)
      : sub === "list" || sub === undefined
        ? await profileListCommand()
        : sub === "import" && a
          ? await profileImportCommand(a, b ?? "imported")
          : sub === "remove" && a
            ? await profileRemoveCommand(a)
            : undefined;
  if (!r) return fail(USAGE, 2);
  if (!r.ok) return fail(`${r.error.kind}: ${r.error.message}`);
  out(json ? JSON.stringify(r.value.data, null, 2) : r.value.text);
  return 0;
}

export async function browsersCommand(json: boolean): Promise<number> {
  const r = await browsersListCommand();
  out(json ? JSON.stringify(r.data, null, 2) : r.text);
  return 0;
}
