// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testCatalog } from "./__fixtures__/test-catalog.ts";
import { createModelClient } from "./model-client.ts";
import { createModelPlanner } from "./model-planner.ts";
import type { ModelProvider } from "./providers/provider-registry.ts";
import { createProviderRegistry } from "./providers/provider-registry.ts";
import type { RoleBindings } from "./role-bindings.ts";

let dir: string;
let shot: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ghosthand-planner-test-"));
  shot = join(dir, "shot.png");
  await writeFile(shot, "png bytes");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const subgoals = [
  {
    id: "s1",
    goal: "Type alice@testbed.local into Email",
    done_when: ['field "Email" has value "alice@testbed.local"'],
    allowed_effects: ["advance"],
    max_steps: 3,
    seed_targets: ["Email"],
  },
  {
    id: "s2",
    goal: "Type [input:TESTBED_PASSWORD] into Password",
    done_when: ['field "Password" is filled'],
    allowed_effects: ["advance"],
    max_steps: 3,
    seed_targets: ["Password"],
  },
  {
    id: "s3",
    goal: "Click Sign in",
    done_when: ["url is /home", 'text "Invalid email or password" is not visible'],
    allowed_effects: ["advance", "commit"],
    max_steps: 3,
    seed_targets: ["Sign in"],
  },
];

function generated(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 200, text: 200, reasoning: 0 },
    },
    warnings: [],
  };
}

const bindings: RoleBindings = { planner: { models: ["openai/fast-json"] } };

function planner(model: MockLanguageModelV4) {
  const provider: ModelProvider = {
    id: "openai",
    kind: "openai",
    configured: true,
    languageModel: () => model,
  };
  return createModelPlanner(
    createModelClient({ catalog: testCatalog(), providers: createProviderRegistry([provider]), bindings }),
  );
}

const input = {
  goal: "Sign in as alice@testbed.local with the stored password [input:TESTBED_PASSWORD]",
  startUrl: "http://127.0.0.1:4400/login",
  maxSubgoals: 6,
};

describe("createModelPlanner", () => {
  it("returns a protocol plan with compiled predicates, model and cost", async () => {
    const model = new MockLanguageModelV4({ doGenerate: generated({ subgoals }) });
    const r = await planner(model).plan({ ...input, screenshot: shot });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.planner).toBe("models");
    expect(r.value.model).toBe("openai/fast-json");
    expect(r.value.costUsd).toBeGreaterThan(0);
    expect(r.value.plan.subgoals[2]?.doneWhen).toEqual({
      all: [{ kind: "url", matches: "/home" }],
      none: [{ kind: "text", text: "Invalid email or password" }],
    });
    expect(r.value.plan.subgoals[1]?.goal).toContain("[input:TESTBED_PASSWORD]");
    const call = model.doGenerateCalls[0];
    const user = call?.prompt.find((m) => m.role === "user");
    const parts = user?.role === "user" ? user.content : [];
    expect(parts.some((p) => p.type === "file" && p.mediaType === "image/png")).toBe(true);
    expect(call?.responseFormat).toMatchObject({ type: "json", name: "plan" });
  });

  it("returns invalid_plan for 2 subgoals, a forbidden effect or empty done_when", async () => {
    for (const bad of [
      { subgoals: subgoals.slice(0, 2) },
      { subgoals: subgoals.map((s) => ({ ...s, allowed_effects: ["forbidden"] })) },
      { subgoals: subgoals.map((s) => ({ ...s, done_when: [] })) },
      { subgoals: subgoals.map((s) => ({ ...s, done_when: [" "] })) },
    ]) {
      const r = await planner(new MockLanguageModelV4({ doGenerate: generated(bad) })).plan(input);
      expect(r.ok ? "ok" : r.error.kind).toBe("invalid_plan");
    }
  });

  it("maps provider failures to unavailable", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "status 503",
          url: "https://api.openai.com/v1/responses",
          requestBodyValues: {},
          statusCode: 503,
        });
      },
    });
    const r = await planner(model).plan(input);
    expect(!r.ok && r.error.kind).toBe("unavailable");
  });

  it("replans with the failure in the prompt and accepts a single replacement subgoal", async () => {
    const first = await planner(new MockLanguageModelV4({ doGenerate: generated({ subgoals }) })).plan(input);
    if (!first.ok) throw new Error(first.error.message);
    const model = new MockLanguageModelV4({ doGenerate: generated({ subgoals: [subgoals[2]] }) });
    const r = await planner(model).replan({
      ...input,
      plan: first.value.plan,
      failedSubgoalId: "s3",
      failureReason: "Sign in button is disabled",
      history: ["typed email", "typed password"],
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.plan.subgoals.map((s) => s.id)).toEqual(["s3"]);
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain("Sign in button is disabled");
  });
});
