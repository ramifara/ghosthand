// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { openRuntime } from "@ghosthand/engine";
import { runsTable } from "../format.ts";
import { fail, out } from "../io.ts";

export async function runsCommand(
  args: string[],
  flags: { limit?: string; task?: string; json?: boolean },
): Promise<number> {
  const sub = args[0] ?? "list";
  if (sub !== "list") return fail(`unknown runs subcommand "${sub}" (expected: list)`, 2);
  const rt = await openRuntime({ logLevel: "silent" });
  if (!rt.ok) return fail(rt.error.message);
  const listed = rt.value.index.listRuns({
    limit: flags.limit ? Number(flags.limit) : 20,
    ...(flags.task ? { taskId: flags.task } : {}),
  });
  if (!listed.ok) return fail(listed.error.message);
  out(flags.json ? JSON.stringify(listed.value, null, 2) : runsTable(listed.value));
  return 0;
}
