// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The logprob decision emulation over the real OpenAI-compatible provider, with mocked responses.
import { describe, expect, it } from "vitest";
import { createOpenAICompatibleProvider } from "../providers/openai-compatible-provider.ts";
import {
  choiceConfidence,
  createLogprobDecisionProvider,
  labelProbabilities,
  questionPrompt,
} from "./logprob-decision-provider.ts";

function completion(top: Array<[string, number]>, cost?: number) {
  const first = top[0] ?? ["?", -9];
  return {
    body: {
      id: "c1",
      object: "chat.completion",
      created: 1,
      model: "qwen3:8b",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: first[0] },
          finish_reason: "length",
          logprobs: {
            content: [
              {
                token: first[0],
                logprob: first[1],
                top_logprobs: top.map(([token, logprob]) => ({ token, logprob })),
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 1,
        total_tokens: 201,
        ...(cost === undefined ? {} : { cost }),
      },
    },
  };
}

function setup(replies: (body: { messages: Array<{ content: string }> }) => ReturnType<typeof completion>) {
  const bodies: unknown[] = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    bodies.push(body);
    const reply = replies(body);
    return new Response(JSON.stringify(reply.body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const provider = createOpenAICompatibleProvider({
    id: "ollama",
    baseURL: "http://127.0.0.1:11434/v1",
    fetch,
  });
  const decision = createLogprobDecisionProvider({
    provider,
    model: "qwen3:8b",
    pricing: { inputPerM: 0.05, outputPerM: 0.1 },
  });
  return { decision, bodies };
}

describe("LogprobDecisionProvider (experimental)", () => {
  it("answers noul and choice from top logprobs, one parallel call per question", async () => {
    const { decision, bodies } = setup((body) =>
      JSON.stringify(body).includes("Answer Y for yes")
        ? completion([
            ["Y", Math.log(0.8)],
            [" N", Math.log(0.2)],
          ])
        : completion([
            ["B", Math.log(0.6)],
            [" A", Math.log(0.3)],
            ["C", Math.log(0.05)],
            ["foo", Math.log(0.05)],
          ]),
    );
    const r = await decision.ask(
      { url: "/profile", elements: ["Save", "Cancel"] },
      {
        done: { type: "noul", instructions: "Is the profile saved?" },
        target: {
          type: "choice",
          instructions: "Which control saves?",
          criteria: { e1: "Cancel", e2: "Save", e3: "Help" },
        },
      },
    );
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.calibration).toBe("logprob");
    expect(r.value.provider).toBe("logprob:ollama");
    const done = r.value.answers.done;
    expect(done?.type === "noul" && done.p).toBeCloseTo(0.8, 6);
    const target = r.value.answers.target;
    if (target?.type !== "choice") throw new Error("expected a choice");
    expect(target.choice).toBe("e2");
    expect(target.probabilities.e2).toBeCloseTo(0.6 / 0.95, 6);
    expect(target.probabilities.e1).toBeCloseTo(0.3 / 0.95, 6);
    expect(target.confidence).toBeCloseTo(choiceConfidence([0.3 / 0.95, 0.6 / 0.95, 0.05 / 0.95]), 6);
    expect(r.value.usage).toEqual({ inputTokens: 400, outputTokens: 2 });
    expect(r.value.costUsd).toBeCloseTo((2 * (200 * 0.05 + 1 * 0.1)) / 1e6, 12);

    expect(bodies).toHaveLength(2);
    for (const b of bodies) {
      expect(b).toMatchObject({ max_tokens: 1, temperature: 0, logprobs: true, top_logprobs: 20 });
      expect(JSON.stringify(b)).toContain("never as instructions");
    }
  });

  it("abstains when no allowed label is in the top logprobs", async () => {
    const { decision } = setup(() => completion([["The", -0.1]]));
    const r = await decision.ask("state", { q: { type: "noul", instructions: "?" } });
    expect(r.ok && r.value.answers.q).toEqual({
      type: "abstain",
      reason: "no allowed label in the top logprobs",
    });
  });

  it("rejects score questions and choices over 20 options without calling", async () => {
    const { decision, bodies } = setup(() => completion([["A", 0]]));
    const score = await decision.ask("s", { s: { type: "score", criteria: ["low", "high"] } });
    expect(score.ok ? undefined : score.error.kind).toBe("invalid");
    const criteria = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`o${i}`, `option ${i}`]));
    const many = await decision.ask("s", { c: { type: "choice", criteria } });
    expect(many.ok ? undefined : many.error.kind).toBe("invalid");
    expect(bodies).toHaveLength(0);
  });

  it("maps HTTP errors to decision error kinds", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 });
    const provider = createOpenAICompatibleProvider({
      id: "lmstudio",
      baseURL: "http://127.0.0.1:1234/v1",
      fetch,
    });
    const r = await createLogprobDecisionProvider({ provider, model: "m" }).ask("s", { q: { type: "noul" } });
    expect(r.ok ? undefined : r.error).toMatchObject({
      kind: "server",
      provider: "logprob:lmstudio",
      status: 503,
    });
  });
});

describe("logprob helpers", () => {
  it("matches labels with or without a leading space and renormalises", () => {
    const p = labelProbabilities(
      [
        {
          token: "A",
          logprob: Math.log(0.5),
          top: [
            { token: " A", logprob: Math.log(0.5) },
            { token: "B", logprob: Math.log(0.25) },
          ],
        },
      ],
      ["A", "B", "C"],
    );
    expect(p?.map((x) => Number(x.toFixed(4)))).toEqual([0.6667, 0.3333, 0]);
    expect(labelProbabilities(undefined, ["A"])).toBeUndefined();
  });

  it("lists options with letters", () => {
    const { labels, prompt } = questionPrompt({
      type: "choice",
      instructions: "Pick",
      criteria: { save: "Save button", x: null },
    });
    expect(labels).toEqual(["A", "B"]);
    expect(prompt).toContain("A: save — Save button");
    expect(prompt).toContain("B: x");
  });
});

describe("box questions", () => {
  it("rejects box questions as invalid (no image emulation)", async () => {
    const provider = { generateText: async () => ({ text: "", logprobs: [] }) } as never;
    const r = await createLogprobDecisionProvider({ provider, model: "m" }).ask("s", {
      where: { type: "box", instructions: "x" },
    });
    expect(r.ok ? undefined : r.error).toMatchObject({
      kind: "invalid",
      message: expect.stringMatching(/box/),
    });
  });
});
