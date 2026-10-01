// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Engine wiring for Phase 6: provider keys, local discovery, role bindings, decision carriers and
// doctor checks. Fake fetch, temp env files, no network, no paid calls.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GhostHandConfigInput } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { createModelsClient } from "./assistants.ts";
import { runDoctor } from "./doctor.ts";
import { listModels, setupModels } from "./model-providers.ts";
import { agentSecretNames, createDecisionProvider, decisionCarrierSettings, openRuntime } from "./runtime.ts";

const NO_ENV: NodeJS.ProcessEnv = {};

async function runtime(envText: string, overrides: GhostHandConfigInput = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gh-providers-"));
  const envPath = join(dir, "env");
  writeFileSync(envPath, envText, { mode: 0o600 });
  const rt = await openRuntime({
    cwd: dir,
    envFilePath: envPath,
    overrides: { runsDir: join(dir, "runs"), ...overrides },
    logLevel: "silent",
  });
  if (!rt.ok) throw new Error(rt.error.message);
  return rt.value;
}

/** Ollama answers on 11434; everything else refuses the connection. */
function localFetch(seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    if (url === "http://127.0.0.1:11434/v1/models") {
      return new Response(JSON.stringify({ data: [{ id: "qwen3:8b" }] }), { status: 200 });
    }
    if (url === "http://127.0.0.1:8000/v1/models") {
      return new Response(JSON.stringify({ data: [{ id: "Qwen/Qwen3-VL-8B" }] }), { status: 200 });
    }
    throw new TypeError("fetch failed");
  }) as typeof fetch;
}

describe("setupModels", () => {
  it("registers every keyed provider and reachable local server, binds roles per provider", async () => {
    const rt = await runtime("ANTHROPIC_API_KEY=sk-ant-test-1\nOPENROUTER_API_KEY=sk-or-test-2\n", {
      models: { local: [{ id: "vllm", baseUrl: "http://127.0.0.1:8000/v1" }] },
    });
    const seen: string[] = [];
    const setup = await setupModels(rt, { env: NO_ENV, fetch: localFetch(seen) });
    expect(setup.keyed).toEqual(["anthropic", "openrouter"]);
    expect(setup.localProviders).toEqual(["vllm", "ollama"]);
    expect(seen.sort()).toEqual([
      "http://127.0.0.1:11434/v1/models",
      "http://127.0.0.1:1234/v1/models",
      "http://127.0.0.1:8000/v1/models",
    ]);
    expect(setup.registry.isConfigured("anthropic")).toBe(true);
    expect(setup.registry.isConfigured("openai")).toBe(false);
    expect(setup.registry.get("ollama")?.kind).toBe("openai-compatible");
    expect(setup.catalog.get("ollama/qwen3:8b")?.pricing).toEqual({ inputPerM: 0, outputPerM: 0 });
    expect(setup.bindings.planner?.models).toEqual([
      "anthropic/claude-sonnet-5-5",
      "openrouter/openai/gpt-6.1-sol",
      "openrouter/anthropic/claude-sonnet-5.5",
    ]);
    expect(rt.secrets.redact("key sk-ant-test-1")).not.toContain("sk-ant-test-1");
  });

  it("uses configured role bindings and catalog overrides over the defaults", async () => {
    const rt = await runtime("", {
      models: {
        discoverLocal: true,
        roles: { writer: { models: ["ollama/qwen3:8b"] } },
        overrides: [{ ref: "ollama/qwen3:8b", inputModalities: ["text", "image"] }],
      },
    });
    const setup = await setupModels(rt, { env: NO_ENV, fetch: localFetch() });
    expect(setup.bindings).toEqual({ writer: { models: ["ollama/qwen3:8b"] } });
    expect(setup.catalog.get("ollama/qwen3:8b")?.inputModalities).toEqual(["text", "image"]);
  });

  it("contacts nothing when discovery is off and no servers are configured", async () => {
    const rt = await runtime("", { models: { discoverLocal: false } });
    const seen: string[] = [];
    expect(await createModelsClient(rt, { env: NO_ENV, fetch: localFetch(seen) })).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("lists models with key presence and local servers", async () => {
    const rt = await runtime("GOOGLE_GENERATIVE_AI_API_KEY=g-test\n");
    const listed = await listModels(rt, { env: NO_ENV, fetch: localFetch() });
    const keys = new Map(listed.data.map((e) => [e.ref, e.key]));
    expect(keys.get("google/gemini-3.8-flash")).toBe("set");
    expect(keys.get("anthropic/claude-sonnet-5-5")).toBe("missing");
    expect(keys.get("ollama/qwen3:8b")).toBe("local");
    expect(listed.text).toContain("local lmstudio: not available");
    expect(listed.text).not.toContain("g-test");
  });
});

describe("decision carriers", () => {
  it("defaults to TypeSafe direct and resolves per-carrier models and key names", async () => {
    const rt = await runtime("", {
      decision: { provider: "openrouter", fallback: { provider: "typesafe" } },
    });
    expect(decisionCarrierSettings(rt.config)).toEqual({
      carrier: "openrouter",
      model: "typesafe/jev-1.13",
      keyEnv: "OPENROUTER_API_KEY",
    });
    expect(decisionCarrierSettings(rt.config, "fallback")).toMatchObject({
      carrier: "typesafe",
      model: "jev-1.13.0",
    });
    const missing = createDecisionProvider(rt, 1, NO_ENV);
    expect(!missing.ok && missing.error.message).toContain("OPENROUTER_API_KEY is not set");
  });

  it("wraps the primary in a failover when the fallback key exists, and skips it otherwise", async () => {
    const both = await runtime("OPENROUTER_API_KEY=sk-or-x\nTYPESAFE_API_KEY=ts-x\n", {
      decision: { provider: "openrouter", fallback: { provider: "typesafe" } },
    });
    const p = createDecisionProvider(both, 1, NO_ENV);
    expect(p.ok && p.value.id).toBe("fallback(openrouter:typesafe/jev-1.13,typesafe:jev-1.13.0)");
    expect(p.ok && p.value.capabilities.contextTokens).toBe(32_000);

    const one = await runtime("AI_GATEWAY_API_KEY=vck-x\n", {
      decision: { provider: "vercel", fallback: { provider: "openrouter" } },
    });
    const q = createDecisionProvider(one, 1, NO_ENV);
    expect(q.ok && q.value.id).toBe("vercel:typesafe-ai/jev");
    expect(one.warnings.join("\n")).toContain("OPENROUTER_API_KEY is not set");
  });

  it("keeps provider keys, including custom key names, out of the agent's secrets", async () => {
    const rt = await runtime("AI_GATEWAY_API_KEY=a\nMY_JEV_KEY=b\nGEMINI_API_KEY=c\nSHOP_PASSWORD=d\n", {
      decision: { provider: "openrouter", apiKeyEnv: "MY_JEV_KEY" },
    });
    expect(agentSecretNames(rt)).toEqual(["SHOP_PASSWORD"]);
  });
});

describe("doctor", () => {
  it("reports the carrier, every provider key and local servers without failing on optional ones", async () => {
    const rt = await runtime("OPENROUTER_API_KEY=sk-or-doc\nANTHROPIC_API_KEY=sk-ant-doc\n", {
      decision: { provider: "openrouter" },
      models: { local: [{ id: "vllm", baseUrl: "http://127.0.0.1:8000/v1" }] },
    });
    const urls: string[] = [];
    const base = localFetch(urls);
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "https://openrouter.ai/api/v1/key") {
        urls.push(String(input));
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-or-doc");
        return new Response("{}", { status: 200 });
      }
      return base(input, init);
    }) as typeof globalThis.fetch;
    const checks = await runDoctor(rt, { fetch, env: NO_ENV, skipBinaries: true });
    const byName = new Map(checks.map((c) => [c.name, c]));
    expect(byName.get("decision openrouter")).toMatchObject({
      ok: true,
      detail: "OPENROUTER_API_KEY accepted (typesafe/jev-1.13)",
    });
    expect(byName.get("models anthropic")).toMatchObject({ ok: true, detail: "ANTHROPIC_API_KEY present" });
    expect(byName.get("models google")).toMatchObject({ ok: true, detail: "no key (optional)" });
    expect(byName.get("local vllm")?.ok).toBe(true);
    expect(byName.get("local ollama")?.detail).toContain("1 model(s)");
    expect(byName.get("local lmstudio")).toMatchObject({
      ok: true,
      detail: expect.stringContaining("not running (optional)"),
    });
    expect(JSON.stringify(checks)).not.toContain("sk-ant-doc");
  });

  it("fails a configured local server that is down and a missing primary key", async () => {
    const rt = await runtime("", {
      models: { discoverLocal: false, local: [{ id: "llamacpp", baseUrl: "http://127.0.0.1:8080/v1" }] },
    });
    const checks = await runDoctor(rt, { fetch: localFetch(), env: NO_ENV, skipBinaries: true });
    const byName = new Map(checks.map((c) => [c.name, c]));
    expect(byName.get("decision typesafe")).toMatchObject({ ok: false });
    expect(byName.get("local llamacpp")).toMatchObject({
      ok: false,
      detail: expect.stringContaining("fetch failed"),
    });
  });
});
