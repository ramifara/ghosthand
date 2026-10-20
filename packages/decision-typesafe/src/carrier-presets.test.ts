// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Jev through OpenRouter and the Vercel AI Gateway with the real SDK and inline responses.
import type { Questions } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import {
  createCarrierDecisionProvider,
  createOpenRouterDecisionProvider,
  createVercelDecisionProvider,
} from "./carrier-presets.ts";
import { CostMeter } from "./cost-meter.ts";
import type { FetchLike } from "./typesafe-provider.ts";

const questions: Questions = {
  done: { type: "noul", instructions: "Is the form saved?" },
  target: { type: "choice", instructions: "Which control?", criteria: { e1: "Save", e2: "Cancel" } },
};

const answers = {
  done: { type: "noul", noul: 0.12 },
  target: { type: "choice", choice: "e1", confidence: 0.8, probabilities: { e1: 0.9, e2: 0.1 } },
};

interface Seen {
  url: string;
  auth: string | null;
  body: Record<string, unknown>;
}

function serve(status: number, body: unknown): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (input, init) => {
    seen.push({
      url: input,
      auth: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, seen };
}

describe("OpenRouter preset", () => {
  it("posts to /api/v1/systemone with typesafe/jev-1.13 and books usage.cost", async () => {
    const http = serve(200, {
      id: "gen-dec-1",
      model: "typesafe/jev-1.13-20260917",
      provider: "TypeSafe",
      answers,
      usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
    });
    const meter = new CostMeter({ capUsd: 1, provider: "openrouter" });
    const p = createOpenRouterDecisionProvider({
      apiKey: "sk-or-test",
      fetch: http.fetch,
      retries: 0,
      costMeter: meter,
    });
    expect(p.id).toBe("openrouter:typesafe/jev-1.13");
    expect(p.capabilities.contextTokens).toBe(32_000);
    const r = await p.ask({ screen: "e1 Save" }, questions);
    if (!r.ok) throw new Error(r.error.message);
    expect(http.seen[0]?.url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(http.seen[0]?.auth).toBe("Bearer sk-or-test");
    expect(http.seen[0]?.body.model).toBe("typesafe/jev-1.13");
    expect(r.value.provider).toBe("openrouter");
    expect(r.value.model).toBe("typesafe/jev-1.13-20260917");
    expect(r.value.costUsd).toBe(0.000019992);
    expect(meter.spentUsd).toBe(0.000019992);
    expect(r.value.answers.target).toMatchObject({ type: "choice", choice: "e1" });
  });

  it("rejects a request over the 32k carrier budget before sending", async () => {
    const http = serve(200, {});
    const p = createOpenRouterDecisionProvider({ apiKey: "k", fetch: http.fetch, retries: 0 });
    const r = await p.ask("x".repeat(200_000), questions);
    expect(r.ok ? undefined : r.error).toMatchObject({ kind: "too_large", provider: "openrouter" });
    expect(http.seen).toHaveLength(0);
  });

  it("maps a 429 with the carrier name", async () => {
    const http = serve(429, { error: { message: "Rate limit exceeded", code: 429 } });
    const p = createOpenRouterDecisionProvider({ apiKey: "k", fetch: http.fetch, retries: 0 });
    const r = await p.ask("s", questions);
    expect(r.ok ? undefined : r.error).toMatchObject({
      kind: "rate_limit",
      provider: "openrouter",
      status: 429,
    });
  });
});

describe("Vercel AI Gateway preset", () => {
  it("posts to /typesafe/v1/systemone with typesafe-ai/jev and reads the gateway cost", async () => {
    const http = serve(200, {
      model: "typesafe-ai/jev",
      answers,
      usage: { input_tokens: 275, output_tokens: 20 },
      provider_metadata: { gateway: { cost: "0.00001155", generationId: "gen_1" } },
    });
    const p = createVercelDecisionProvider({ apiKey: "vck-test", fetch: http.fetch, retries: 0 });
    const r = await p.ask("state", questions);
    if (!r.ok) throw new Error(r.error.message);
    expect(http.seen[0]?.url).toBe("https://ai-gateway.vercel.sh/typesafe/v1/systemone");
    expect(http.seen[0]?.body.model).toBe("typesafe-ai/jev");
    expect(r.value.provider).toBe("vercel");
    expect(r.value.costUsd).toBeCloseTo(0.00001155, 12);
  });

  it("prices tokens itself when the gateway cost is missing or garbled", async () => {
    const http = serve(200, {
      model: "typesafe-ai/jev",
      answers,
      usage: { input_tokens: 1_000_000, output_tokens: 1 },
      provider_metadata: { gateway: { cost: "n/a" } },
    });
    const p = createCarrierDecisionProvider("vercel", {
      apiKey: "k",
      fetch: http.fetch,
      retries: 0,
      priceInputPerM: 0.042,
      skipPreflight: true,
    });
    const r = await p.ask("s", questions);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.costUsd).toBeCloseTo(0.042, 9);
  });
});

describe("createCarrierDecisionProvider", () => {
  it("keeps TypeSafe direct as the default carrier", () => {
    expect(createCarrierDecisionProvider("typesafe", { apiKey: "k" }).id).toBe("typesafe:jev-1.13.0");
    expect(
      createCarrierDecisionProvider("openrouter", { apiKey: "k", model: "~typesafe/jev-latest" }).id,
    ).toBe("openrouter:~typesafe/jev-latest");
  });
});

describe("carrier compression", () => {
  it("sends uncompressed bodies to gateways (zstd support there is unverified)", async () => {
    const big = { screen: "e1 Save ".repeat(400) };
    const http = serve(200, {
      model: "typesafe/jev-1.13-20260917",
      answers,
      usage: { input_tokens: 476, output_tokens: 70, cost: 0.00002 },
    });
    const p = createOpenRouterDecisionProvider({ apiKey: "sk-or-test", fetch: http.fetch, retries: 0 });
    const r = await p.ask(big, questions);
    expect(r.ok).toBe(true);
    expect(http.seen[0]?.body.state).toEqual(big);
  });
});
