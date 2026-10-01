// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { writeFileSync } from "node:fs";
import { exportPlaywrightSpec, openRuntime } from "@ghosthand/engine";
import { actionsForReplay, readRun } from "@ghosthand/recorder";
import { fail, out } from "../io.ts";

export async function exportCommand(runId: string | undefined, flags: { out?: string }): Promise<number> {
  if (!runId) return fail("usage: ghosthand export <runId> [--out file.spec.ts]", 2);
  const rt = await openRuntime({ logLevel: "silent" });
  if (!rt.ok) return fail(rt.error.message);
  const log = readRun(runId, { runsDir: rt.value.runsDir });
  if (!log.ok) return fail(log.error.message);
  const start = log.value.events.find((e) => e.type === "run.start");
  if (start?.type !== "run.start") return fail(`run ${runId} has no run.start event`);
  const steps = actionsForReplay(log.value.events).map((a) => ({
    step: a.step,
    action: a.action,
    target: a.target ?? null,
  }));
  const spec = exportPlaywrightSpec(start.task, steps);
  if (flags.out) {
    writeFileSync(flags.out, spec);
    out(`wrote ${flags.out}`);
  } else out(spec);
  return 0;
}
