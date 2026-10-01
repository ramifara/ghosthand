// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { tasks } from "@ghosthand/testbed-kit";
import { table } from "../format.ts";
import { out } from "../io.ts";

export function tasksCommand(json: boolean): number {
  if (json)
    out(
      JSON.stringify(
        tasks.map((t) => ({
          id: t.id,
          version: t.version,
          level: t.level,
          start: t.start,
          instruction: t.instruction,
        })),
        null,
        2,
      ),
    );
  else
    out(
      table([
        ["TASK", "LEVEL", "START", "INSTRUCTION"],
        ...tasks.map((t) => [`${t.id}@${t.version}`, `L${t.level}`, t.start, t.instruction.slice(0, 90)]),
      ]),
    );
  return 0;
}
