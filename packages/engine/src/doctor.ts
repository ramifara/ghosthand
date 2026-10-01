// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand doctor`: Node, env file, decision carrier key and auth, model provider keys, local model
// servers, browser, Codex and Claude CLIs, runs folder. No paid calls; keys are only checked for
// presence and against free endpoints.
import { accessSync, constants } from "node:fs";
import { createClaudeConsultant, createCodexConsultant } from "@ghosthand/consultants";
import { detectBrowsers, nodeBrowserHost } from "@ghosthand/driver-playwright";
import { DEFAULT_LOCAL_SERVERS, discoverLocalModels } from "@ghosthand/models";
import type { DoctorCheck } from "@ghosthand/protocol";
import { envValue } from "./env-file.ts";
import { localServers, providerKeys } from "./model-providers.ts";
import type { DecisionCarrierSettings, EngineRuntime } from "./runtime.ts";
import { decisionCarrierSettings } from "./runtime.ts";

export interface DoctorOptions {
  /** Network checks (decision auth, local servers). No paid calls. Default true. */
  network?: boolean;
  fetch?: typeof fetch;
  codexBinary?: string;
  claudeBinary?: string;
  /** Skip the browser and CLI probes (tests). */
  skipBinaries?: boolean;
  env?: NodeJS.ProcessEnv;
}

/** A free endpoint per carrier that checks the key. */
function authUrl(s: DecisionCarrierSettings): string {
  switch (s.carrier) {
    case "openrouter":
      // OpenRouter rejects models.list through the System One path; /key describes the key for free.
      return "https://openrouter.ai/api/v1/key";
    case "vercel":
      return `${s.baseUrl ?? "https://ai-gateway.vercel.sh/typesafe"}/v1/models`;
    case "typesafe":
      return `${s.baseUrl ?? "https://api.typesafe.ai"}/v1/models`;
  }
}

async function decisionChecks(rt: EngineRuntime, opts: DoctorOptions): Promise<DoctorCheck[]> {
  const env = opts.env ?? process.env;
  const checks: DoctorCheck[] = [];
  const primary = decisionCarrierSettings(rt.config, "primary");
  const fallback = decisionCarrierSettings(rt.config, "fallback");
  for (const [role, s] of [
    ["decision", primary],
    ["fallback", fallback],
  ] as const) {
    if (s === undefined) continue;
    const name = `${role} ${s.carrier}`;
    const key = envValue(s.keyEnv, rt.envFile, env);
    if (!key) {
      checks.push({
        name,
        ok: role === "fallback",
        detail: `${s.keyEnv} missing (add it to ${rt.envFile.path}, mode 0600)${role === "fallback" ? "; fallback disabled" : ""}`,
      });
      continue;
    }
    rt.secrets.register(s.keyEnv, key);
    if (opts.network === false) {
      checks.push({ name, ok: true, detail: `${s.keyEnv} present (${s.model})` });
      continue;
    }
    const f = opts.fetch ?? fetch;
    try {
      const res = await f(authUrl(s), {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      });
      const ok = res.status === 200;
      checks.push({
        name,
        ok,
        detail: ok
          ? `${s.keyEnv} accepted (${s.model})`
          : `HTTP ${res.status}${res.status === 401 ? " (bad key)" : ""}`,
      });
    } catch (e) {
      checks.push({ name, ok: false, detail: `unreachable: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return checks;
}

/** One line per hosted provider: a key is optional, so a missing one is not a failure. */
function providerKeyChecks(rt: EngineRuntime, env: NodeJS.ProcessEnv): DoctorCheck[] {
  return providerKeys(rt, env).map((k) => ({
    name: `models ${k.provider}`,
    ok: true,
    detail: k.env ? `${k.env} present` : "no key (optional)",
  }));
}

async function localServerChecks(rt: EngineRuntime, opts: DoctorOptions): Promise<DoctorCheck[]> {
  const servers = localServers(rt, opts.env ?? process.env);
  if (servers.length === 0) return [];
  if (opts.network === false) {
    return servers.map((s) => ({ name: `local ${s.id}`, ok: true, detail: `${s.baseURL} (not checked)` }));
  }
  const found = await discoverLocalModels({ servers, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const defaults = new Set(DEFAULT_LOCAL_SERVERS.map((s) => s.baseURL));
  return found.map((s) => {
    const usable = s.reachable && s.models.length > 0;
    // Default loopback ports are a guess; only a server the user configured must be up.
    const configured = !defaults.has(s.baseURL);
    return {
      name: `local ${s.id}`,
      ok: usable || !configured,
      detail: usable
        ? `${s.models.length} model(s) at ${s.baseURL} (${s.latencyMs} ms)`
        : `${configured ? "" : "not running (optional) "}${s.baseURL}${s.error ? `: ${s.error}` : ""}`.trim(),
    };
  });
}

async function claudeCheck(rt: EngineRuntime, opts: DoctorOptions): Promise<DoctorCheck> {
  const cfg = rt.config.consultant.claude;
  const binary = opts.claudeBinary ?? cfg.binary;
  const probe = await createClaudeConsultant(binary === undefined ? {} : { binary }).probeDetailed();
  const optIn = cfg.enabled ? "enabled" : "disabled in config (opt-in, consultant.claude.enabled)";
  if (!probe.installed) {
    return { name: "claude", ok: !cfg.enabled, detail: `not installed (optional; ${optIn})` };
  }
  const login =
    probe.auth === "none"
      ? "not logged in (run `claude auth login` in a terminal)"
      : `auth ${probe.auth}${probe.plan ? `, plan ${probe.plan}` : ""}`;
  return {
    name: "claude",
    ok: !cfg.enabled || probe.auth !== "none",
    detail: `${probe.version ?? "?"}, ${login}; ${optIn}`,
  };
}

export async function runDoctor(rt: EngineRuntime, opts: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const env = opts.env ?? process.env;
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
  checks.push(...(await decisionChecks(rt, opts)));
  checks.push(...providerKeyChecks(rt, env));
  checks.push(...(await localServerChecks(rt, opts)));

  if (opts.skipBinaries !== true) {
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
    checks.push(await claudeCheck(rt, opts));
  }

  try {
    accessSync(rt.runsDir, constants.W_OK);
    checks.push({ name: "runs folder", ok: true, detail: rt.runsDir });
  } catch {
    checks.push({ name: "runs folder", ok: false, detail: `${rt.runsDir} is not writable` });
  }
  return checks;
}
