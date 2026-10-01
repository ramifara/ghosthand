// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand models list`: catalog models per provider with role badges, computer-use support and key
// state (keys are checked for presence only), plus local servers found on configured/default URLs.
import { listModels, openRuntime } from "@ghosthand/engine";
import { fail, out } from "../io.ts";

const ROLES = ["planner", "writer", "vision_reviewer", "vision_grounder", "judge"] as const;
type Role = (typeof ROLES)[number];

const isRole = (v: string): v is Role => (ROLES as readonly string[]).includes(v);

export async function modelsCommand(
  args: string[],
  flags: { json: boolean; provider?: string; role?: string; all?: boolean; config?: string },
): Promise<number> {
  const [sub = "list"] = args;
  if (sub !== "list") return fail(`unknown models command "${sub}" (expected: list)`, 2);
  if (flags.role !== undefined && !isRole(flags.role)) {
    return fail(`--role must be one of ${ROLES.join(", ")}`, 2);
  }
  const rt = await openRuntime({ logLevel: "silent", ...(flags.config ? { configPath: flags.config } : {}) });
  if (!rt.ok) return fail(rt.error.message);
  const listed = await listModels(rt.value, {
    ...(flags.provider === undefined ? {} : { provider: flags.provider }),
    ...(flags.role !== undefined && isRole(flags.role) ? { role: flags.role } : {}),
    ...(flags.all === undefined ? {} : { all: flags.all }),
  });
  if (flags.json) out(JSON.stringify({ models: listed.data, local: listed.local }, null, 2));
  else out(listed.text);
  return 0;
}
