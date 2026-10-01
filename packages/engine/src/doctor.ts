// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand doctor`: Node, env file, TypeSafe key, browser, Codex, runs folder.
import { accessSync, constants } from "node:fs";
import { createCodexConsultant } from "@ghosthand/consultants";
import { detectBrowsers, nodeBrowserHost } from "@ghosthand/driver-playwright";
import type { DoctorCheck } from "@ghosthand/protocol";
import { envValue } from "./env-file.ts";
import type { EngineRuntime } from "./runtime.ts";

export interface DoctorOptions {
  /** Network checks against api.typesafe.ai (no paid calls). Default true. */
  network?: boolean;
  fetch?: typeof fetch;
  codexBinary?: string;
}

async function typesafeChecks(rt: EngineRuntime, opts: DoctorOptions): Promise<DoctorCheck[]> {
  const key = envValue("TYPESAFE_API_KEY", rt.envFile);
  if (!key) {
    return [
      {
        name: "typesafe key",
        ok: false,
        detail: `TYPESAFE_API_KEY missing (add it to ${rt.envFile.path}, mode 0600)`,
      },
    ];
  }
  rt.secrets.register("TYPESAFE_API_KEY", key);
  const checks: DoctorCheck[] = [{ name: "typesafe key", ok: true, detail: "present" }];
  if (opts.network === false) return checks;
  const f = opts.fetch ?? fetch;
  const base = rt.config.decision.baseUrl ?? "https://api.typesafe.ai";
  try {
    // GET /v1/models is free; it checks that the key is accepted.
    const res = await f(`${base}/v1/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    const ok = res.status === 200;
    checks.push({
      name: "typesafe auth",
      ok,
      detail: ok
        ? `accepted (${rt.config.decision.model})`
        : `HTTP ${res.status}${res.status === 401 ? " (bad key)" : ""}`,
    });
  } catch (e) {
    checks.push({
      name: "typesafe auth",
      ok: false,
      detail: `unreachable: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  return checks;
}

export async function runDoctor(rt: EngineRuntime, opts: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    ok: major >= 24,
    detail: `v${process.versions.node}${major >= 24 ? "" : " (need 24+)"}`,
  });
  checks.push({
    name: "env file",
    ok: !rt.envFile.insecure,
    detail:
      rt.envFile.values.size === 0
        ? `${rt.envFile.path} (missing or empty)`
        : `${rt.envFile.path}${rt.envFile.insecure ? " is readable by others; chmod 600" : ""}`,
  });
  checks.push(...(await typesafeChecks(rt, opts)));

  const browsers = await detectBrowsers(nodeBrowserHost(), { withVersion: true });
  const first = browsers[0];
  checks.push({
    name: "browser",
    ok: first !== undefined,
    detail: first
      ? `${first.kind} ${first.version ?? ""} ${first.executablePath}`.replace(/\s+/g, " ")
      : "no Chrome, Edge or Brave found",
  });

  const codex = await createCodexConsultant(opts.codexBinary ? { binary: opts.codexBinary } : {}).probe();
  checks.push({
    name: "codex",
    ok: codex.installed && codex.auth !== "none",
    detail: !codex.installed
      ? "not installed (optional; used for planning)"
      : `${codex.version ?? "?"}, auth ${codex.auth}${codex.plan ? `, plan ${codex.plan}` : ""}, ${codex.models.length} models`,
  });

  try {
    accessSync(rt.runsDir, constants.W_OK);
    checks.push({ name: "runs folder", ok: true, detail: rt.runsDir });
  } catch {
    checks.push({ name: "runs folder", ok: false, detail: `${rt.runsDir} is not writable` });
  }
  return checks;
}
