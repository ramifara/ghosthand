// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { openRuntime, runDoctor } from "@ghosthand/engine";
import { fail, out } from "../io.ts";

export async function doctorCommand(json: boolean): Promise<number> {
  const rt = await openRuntime({ logLevel: "silent" });
  if (!rt.ok) return fail(rt.error.message);
  const checks = await runDoctor(rt.value);
  if (json) out(JSON.stringify(checks, null, 2));
  else for (const c of checks) out(`${c.ok ? "ok  " : "FAIL"}  ${c.name.padEnd(13)} ${c.detail}`);
  for (const w of rt.value.warnings) out(`warn  ${w}`);
  return checks.every((c) => c.ok) ? 0 : 1;
}
