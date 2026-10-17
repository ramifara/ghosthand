// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { DecisionError, DecisionResponse, Questions, Result } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { CostMeter } from "./cost-meter.ts";
import type { DecisionLogger, LogFields } from "./logger.ts";
import { failingFetch, hangingFetch, recordedFetch } from "./recorded-fetch.ts";
import type { TypeSafeDecisionProviderOptions } from "./typesafe-provider.ts";
import { createTypeSafeDecisionProvider } from "./typesafe-provider.ts";

const TEST_KEY = "test-key-not-real";
const STATE_MARKER = "SECRET-STATE-MARKER-7f3a";

const state = {
  task: "Sign in as the demo user",
  screen: `e1 textbox "Email" <empty>\ne2 button "Sign in"\ne3 link "Forgot password?"\nnote: ${STATE_MARKER}`,
};

const questions: Questions = {
  goal_done: { type: "noul", instructions: "Has `task` been completed on `screen`?" },
  target: {
    type: "choice",
    instructions: "Which element should be pressed next to progress `task`?",
    criteria: { e1: "Email field", e2: "Sign in button", e3: "Forgot password link", none: null },
  },
  risk: {
    type: "score",
    instructions: "How risky is pressing the chosen element?",
    criteria: ["read-only", "reversible", "irreversible"],
  },
};

interface LogLine {
  level: string;
  obj: LogFields;
  msg: string;
}

function captureLogger(): { logger: DecisionLogger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const at =
    (level: string) =>
    (obj: LogFields, msg: string): void => {
      lines.push({ level, obj, msg });
    };
  return { logger: { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") }, lines };
}

function provider(
  fetch: TypeSafeDecisionProviderOptions["fetch"],
  extra: Partial<TypeSafeDecisionProviderOptions> = {},
) {
  return createTypeSafeDecisionProvider({
    apiKey: TEST_KEY,
    retries: 0,
    ...(fetch ? { fetch } : {}),
    ...extra,
  });
}

function expectOk(r: Result<DecisionResponse, DecisionError>): DecisionResponse {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

function expectErr(r: Result<DecisionResponse, DecisionError>): DecisionError {
  if (r.ok) throw new Error("expected an error");
  return r.error;
}

describe("createTypeSafeDecisionProvider", () => {
  it("advertises the direct API capabilities and a pinned id", () => {
    const p = provider(undefined);
    expect(p.id).toBe("typesafe:jev-1.13.0");
    expect(p.capabilities).toEqual({
      maxOptions: 255,
      maxLevels: 10,
      contextTokens: 64_000,
      perQuestionContextTokens: 32_000,
      zdr: false,
    });
  });

  it("answers all three question types from a recorded response", async () => {
    const rec = recordedFetch("systemone-all-types");
    const r = expectOk(await provider(rec.fetch).ask(state, questions));
    expect(r.answers).toEqual({
      goal_done: { type: "noul", p: 0.08 },
      target: {
        type: "choice",
        choice: "e2",
        confidence: 0.87,
        probabilities: { e1: 0.04, e2: 0.91, e3: 0.03, none: 0.02 },
      },
      risk: {
        type: "score",
        score: 0.08,
        confidence: 0.9,
        probabilities: { "0": 0.93, "1": 0.06, "2": 0.01 },
      },
    });
    expect(r).toMatchObject({
      model: "jev-1.13.0",
      provider: "typesafe",
      requestId: "req_4f1c2a9e7b3d4c8a9e0f1a2b3c4d5e6f",
      usage: { inputTokens: 1834, outputTokens: 15 },
      calibration: "native",
    });
    expect(r.costUsd).toBeCloseTo((1834 * 0.042) / 1e6, 12);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends the pinned model, the state and SDK-shaped questions to /v1/systemone", async () => {
    const rec = recordedFetch("systemone-all-types");
    await provider(rec.fetch).ask(state, questions);
    expect(rec.calls).toHaveLength(1);
    const call = rec.calls[0];
    expect(call?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(call?.headers.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(call?.body).toEqual({ state, questions, model: "jev-1.13.0" });
  });

  it("honours baseUrl and a custom model", async () => {
    const rec = recordedFetch("systemone-all-types");
    await provider(rec.fetch, { baseUrl: "https://gateway.example/typesafe/", model: "jev-latest" }).ask(
      state,
      questions,
    );
    expect(rec.calls[0]?.url).toBe("https://gateway.example/typesafe/v1/systemone");
    expect(rec.calls[0]?.body).toMatchObject({ model: "jev-latest" });
  });

  it("accepts a tied choice", async () => {
    const rec = recordedFetch("systemone-choice-tie");
    const target = questions.target;
    if (!target) throw new Error("fixture");
    const r = expectOk(await provider(rec.fetch).ask(state, { target }));
    expect(r.answers.target).toMatchObject({ type: "choice", choice: "e1" });
  });

  it("abstains answers that fail validation and keeps the rest", async () => {
    const { logger, lines } = captureLogger();
    const rec = recordedFetch("systemone-bad-probabilities");
    const r = expectOk(await provider(rec.fetch, { logger }).ask(state, questions));
    expect(r.answers.goal_done).toEqual({ type: "noul", p: 0.97 });
    expect(r.answers.target).toMatchObject({ type: "abstain", reason: expect.stringMatching(/sum to 0\.8/) });
    expect(r.answers.risk).toMatchObject({
      type: "abstain",
      reason: expect.stringMatching(/distribution mean/),
    });
    expect(lines.find((l) => l.msg === "decision.abstain")?.obj).toMatchObject({
      requestId: "req_9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b",
    });
  });

  it("abstains every answer when one is missing", async () => {
    const rec = recordedFetch("systemone-missing-answer");
    const r = expectOk(await provider(rec.fetch).ask(state, questions));
    expect(Object.values(r.answers).every((a) => a.type === "abstain")).toBe(true);
  });

  it("returns a server error for a malformed 200 body", async () => {
    const rec = recordedFetch("systemone-malformed");
    const e = expectErr(
      await provider(rec.fetch).ask(state, { goal_done: { type: "noul", instructions: "Done?" } }),
    );
    expect(e).toMatchObject({ kind: "server", requestId: "req_aaaabbbbccccddddeeeeffff00001111" });
  });

  describe("error mapping from recorded responses", () => {
    it.each([
      ["error-401", "auth", 401],
      ["error-403", "auth", 403],
      ["error-422-validation", "invalid", 422],
      ["error-422-context", "too_large", 422],
      ["error-400-max-tokens", "too_large", 400],
      ["error-429", "rate_limit", 429],
      ["error-500", "server", 500],
      ["error-529", "overloaded", 529],
    ])("%s → %s", async (name, kind, status) => {
      const rec = recordedFetch(name);
      const e = expectErr(await provider(rec.fetch).ask(state, questions));
      expect(e).toMatchObject({
        kind,
        status,
        provider: "typesafe",
        requestId: expect.stringMatching(/^req_/),
      });
    });

    it("carries retryAfterMs on 429", async () => {
      const e = expectErr(await provider(recordedFetch("error-429").fetch).ask(state, questions));
      expect(e.retryAfterMs).toBe(750);
    });

    it("retries once on 529 and then succeeds", async () => {
      const rec = recordedFetch("error-529", "systemone-all-types");
      const r = await provider(rec.fetch, { retries: 1 }).ask(state, questions);
      expect(r.ok).toBe(true);
      expect(rec.calls).toHaveLength(2);
      expect(rec.calls[1]?.headers["x-typesafe-retry-count"]).toBe("1");
    });

    it("does not retry a 401", async () => {
      const rec = recordedFetch("error-401", "systemone-all-types");
      const e = expectErr(await provider(rec.fetch, { retries: 1 }).ask(state, questions));
      expect(e.kind).toBe("auth");
      expect(rec.calls).toHaveLength(1);
    });

    it("maps a per-attempt timeout", async () => {
      const rec = hangingFetch();
      const e = expectErr(await provider(rec.fetch, { timeoutMs: 20 }).ask(state, questions));
      expect(e.kind).toBe("timeout");
    });

    it("maps a connection failure", async () => {
      const e = expectErr(await provider(failingFetch().fetch).ask(state, questions));
      expect(e.kind).toBe("network");
    });

    it("returns auth without a request when the key is empty", async () => {
      const rec = recordedFetch("systemone-all-types");
      const e = expectErr(await provider(rec.fetch, { apiKey: " " }).ask(state, questions));
      expect(e.kind).toBe("auth");
      expect(rec.calls).toHaveLength(0);
    });
  });

  describe("abort signal", () => {
    it("returns aborted without sending when the signal is already aborted", async () => {
      const rec = recordedFetch("systemone-all-types");
      const ac = new AbortController();
      ac.abort();
      const e = expectErr(await provider(rec.fetch).ask(state, questions, { signal: ac.signal }));
      expect(e.kind).toBe("aborted");
      expect(rec.calls).toHaveLength(0);
    });

    it("returns aborted when the signal fires mid-request", async () => {
      const rec = hangingFetch();
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 10);
      const e = expectErr(
        await provider(rec.fetch, { timeoutMs: 5000 }).ask(state, questions, { signal: ac.signal }),
      );
      expect(e.kind).toBe("aborted");
      expect(rec.calls).toHaveLength(1);
    });
  });

  describe("preflight", () => {
    it("rejects 256 options without sending", async () => {
      const rec = recordedFetch("systemone-all-types");
      const criteria = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`e${i}`, null]));
      const e = expectErr(await provider(rec.fetch).ask(state, { target: { type: "choice", criteria } }));
      expect(e.kind).toBe("invalid");
      expect(rec.calls).toHaveLength(0);
    });

    it("sends an over-cap request when skipPreflight is set (limit probes)", async () => {
      const rec = recordedFetch("error-422-validation");
      const criteria = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`e${i}`, null]));
      const e = expectErr(
        await provider(rec.fetch, { skipPreflight: true }).ask(state, {
          target: { type: "choice", criteria },
        }),
      );
      expect(e).toMatchObject({ kind: "invalid", status: 422 });
      expect(rec.calls).toHaveLength(1);
    });

    it("rejects an oversized state as too_large without sending", async () => {
      const rec = recordedFetch("systemone-all-types");
      const e = expectErr(await provider(rec.fetch).ask("x".repeat(100_000), questions));
      expect(e.kind).toBe("too_large");
      expect(rec.calls).toHaveLength(0);
    });
  });

  describe("cost meter", () => {
    it("charges the shared meter and stops at the cap", async () => {
      // Fits one 1834-token call ($0.000077) but not a second (estimate ~$0.00001 on top).
      const meter = new CostMeter({ capUsd: 0.00008 });
      const rec = recordedFetch("systemone-all-types");
      const p = provider(rec.fetch, { costMeter: meter });
      expectOk(await p.ask(state, questions));
      expect(meter.spentUsd).toBeCloseTo((1834 * 0.042) / 1e6, 12);
      const e = expectErr(await p.ask(state, questions));
      expect(e.kind).toBe("budget");
      expect(rec.calls).toHaveLength(1);
    });

    it("uses the configured price", async () => {
      const r = expectOk(
        await provider(recordedFetch("systemone-all-types").fetch, { priceInputPerM: 1 }).ask(
          state,
          questions,
        ),
      );
      expect(r.costUsd).toBeCloseTo(0.001834, 12);
    });
  });

  describe("logging", () => {
    it("logs names, types, tokens, latency and request id, never state or criteria text", async () => {
      const { logger, lines } = captureLogger();
      await provider(recordedFetch("systemone-all-types").fetch, { logger }).ask(state, questions);
      await provider(recordedFetch("error-529").fetch, { logger }).ask(state, questions);
      const request = lines.find((l) => l.msg === "decision.request");
      expect(request?.obj).toMatchObject({
        model: "jev-1.13.0",
        questions: [
          { name: "goal_done", type: "noul" },
          { name: "target", type: "choice", options: 4 },
          { name: "risk", type: "score", levels: 3 },
        ],
      });
      const response = lines.find((l) => l.msg === "decision.response");
      expect(response?.obj).toMatchObject({
        requestId: "req_4f1c2a9e7b3d4c8a9e0f1a2b3c4d5e6f",
        inputTokens: 1834,
        outputTokens: 15,
        latencyMs: expect.any(Number),
      });
      expect(lines.find((l) => l.msg === "decision.error")?.obj).toMatchObject({
        kind: "overloaded",
        status: 529,
      });
      const dump = JSON.stringify(lines);
      expect(dump).not.toContain(STATE_MARKER);
      expect(dump).not.toContain("Sign in button");
      expect(dump).not.toContain(TEST_KEY);
    });
  });
});

describe("request compression (SDK 0.7.0)", () => {
  const big = { ...state, filler: "y".repeat(3000) };

  it("zstd-compresses bodies of 1 KiB or more by default, and the recorded transport decodes them", async () => {
    const rec = recordedFetch("systemone-all-types");
    await provider(rec.fetch).ask(big, questions);
    expect(rec.calls[0]?.headers["content-encoding"]).toBe("zstd");
    expect(rec.calls[0]?.body).toMatchObject({ model: "jev-1.13.0", state: big });
  });

  it("sends plain JSON when compression is off", async () => {
    const rec = recordedFetch("systemone-all-types");
    await provider(rec.fetch, { compression: false }).ask(big, questions);
    expect(rec.calls[0]?.headers["content-encoding"]).toBeUndefined();
    expect(rec.calls[0]?.body).toMatchObject({ model: "jev-1.13.0", state: big });
  });
});

describe("SDK 0.7.0 request and usage edge cases", () => {
  it("rejects a null state as invalid without sending (the API requires a state)", async () => {
    const rec = recordedFetch("systemone-all-types");
    const e = expectErr(await provider(rec.fetch).ask(null, questions));
    expect(e.kind).toBe("invalid");
    expect(rec.calls).toHaveLength(0);
  });

  it("falls back to the preflight estimate when usage token counts are null", async () => {
    const { logger, lines } = captureLogger();
    const rec = recordedFetch("systemone-usage-null");
    const r = expectOk(
      await provider(rec.fetch, { logger }).ask(state, {
        goal_done: { type: "noul", instructions: "Done?" },
      }),
    );
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    expect(r.usage.outputTokens).toBe(0);
    expect(r.costUsd).toBeCloseTo((r.usage.inputTokens * 0.042) / 1e6, 12);
    expect(lines.find((l) => l.msg === "decision.response")?.obj).toMatchObject({ usageSource: "estimate" });
  });
});
