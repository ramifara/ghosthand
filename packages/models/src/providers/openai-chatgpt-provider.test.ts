// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// SIWC plan provider against a fake fetch that speaks server-sent events. No network, no token.
import { describe, expect, it } from "vitest";
import { createModelCatalog } from "../catalog/model-catalog.ts";
import { createModelClient } from "../model-client.ts";
import { loadRecording } from "../recorded-fetch.ts";
import {
  adaptSiwcRequestBody,
  collectSiwcStream,
  createOpenAIChatGptProvider,
  createSiwcFetch,
  parseSseEvents,
  SIWC_USAGE_LIMIT_CODE,
} from "./openai-chatgpt-provider.ts";
import { createProviderRegistry } from "./provider-registry.ts";

const sse = (...events: unknown[]): string =>
  `${events.map((e) => `event: x\ndata: ${JSON.stringify(e)}`).join("\n\n")}\n\n`;

interface Seen {
  url: string;
  headers: Headers;
  body: Record<string, unknown> | undefined;
}

function fakeFetch(respond: () => Response) {
  const seen: Seen[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push({
      url,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    });
    return respond();
  };
  return { fetch, seen };
}

const completed = (loadRecording("responses-hint-ok").response.body ?? {}) as Record<string, unknown>;

describe("adaptSiwcRequestBody", () => {
  it("forces store:false and stream:true, strips rejected params and maps system to developer", () => {
    const out = adaptSiwcRequestBody({
      model: "gpt-6-luna",
      input: [
        { role: "system", content: "be brief" },
        { role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
      temperature: 0.2,
      max_output_tokens: 100,
      user: "u",
      previous_response_id: "resp_1",
      store: true,
      reasoning: { effort: "low" },
    });
    expect(out).toEqual({
      model: "gpt-6-luna",
      input: [
        { role: "developer", content: "be brief" },
        { role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
      reasoning: { effort: "low" },
      store: false,
      stream: true,
    });
  });

  it("wraps a string input into an array", () => {
    expect(adaptSiwcRequestBody({ input: "hello" }).input).toEqual([{ role: "user", content: "hello" }]);
  });
});

describe("collectSiwcStream", () => {
  it("returns the response.completed payload as JSON", async () => {
    const res = await collectSiwcStream(
      new Response(sse({ type: "response.created" }, { type: "response.completed", response: completed }), {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": "req_1" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("req_1");
    expect(((await res.json()) as { id: string }).id).toBe(completed.id);
  });

  it("maps the plan usage limit to 429 and other failures to 400", async () => {
    const limit = await collectSiwcStream(
      new Response(
        sse({
          type: "response.failed",
          response: { error: { code: SIWC_USAGE_LIMIT_CODE, message: "limit reached" } },
        }),
      ),
    );
    expect(limit.status).toBe(429);
    const other = await collectSiwcStream(new Response(sse({ type: "error", error: { message: "bad" } })));
    expect(other.status).toBe(400);
    const truncated = await collectSiwcStream(new Response(sse({ type: "response.output_text.delta" })));
    expect(truncated.status).toBe(502);
  });

  it("passes HTTP errors through", async () => {
    const res = await collectSiwcStream(new Response("{}", { status: 401 }));
    expect(res.status).toBe(401);
  });

  it("parses SSE blocks and ignores [DONE] and junk", () => {
    expect(parseSseEvents('data: {"a":1}\n\ndata: [DONE]\n\n: ping\n\ndata: nope\n\n')).toEqual([{ a: 1 }]);
  });
});

describe("createSiwcFetch", () => {
  it("never sends a plan token anywhere but api.openai.com/v1", async () => {
    const { fetch, seen } = fakeFetch(() => new Response("{}"));
    const f = createSiwcFetch(() => "tok", fetch);
    const res = await f("https://chatgpt.com/backend-api/codex/responses", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it("returns 401 without a token and does not call out", async () => {
    const { fetch, seen } = fakeFetch(() => new Response("{}"));
    const res = await createSiwcFetch(() => undefined, fetch)("https://api.openai.com/v1/models");
    expect(res.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("injects the bearer token on other endpoints without rewriting", async () => {
    const { fetch, seen } = fakeFetch(() => new Response('{"data":[]}'));
    await createSiwcFetch(() => "tok-123", fetch)("https://api.openai.com/v1/models");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer tok-123");
  });
});

describe("openai-chatgpt provider through the model client", () => {
  it("completes a writer call over the plan with a streamed response", async () => {
    const { fetch, seen } = fakeFetch(
      () =>
        new Response(sse({ type: "response.completed", response: completed }), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const catalog = createModelCatalog();
    if (!catalog.ok) throw new Error(catalog.error.message);
    const provider = createOpenAIChatGptProvider({ getAccessToken: () => "plan-token", fetch });
    expect(provider.kind).toBe("openai-chatgpt");
    expect(provider.id).toBe("openai");
    expect(provider.configured).toBe(true);
    const client = createModelClient({
      catalog: catalog.value,
      providers: createProviderRegistry([provider]),
      bindings: { writer: { models: ["openai/gpt-6-luna"], maxOutputTokens: 50 } },
    });
    const r = await client.generateText({ role: "writer", system: "Be brief.", prompt: "hint please" });
    if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
    expect(r.value.value).toContain("Display name");
    const call = seen[0];
    expect(call?.url).toBe("https://api.openai.com/v1/responses");
    expect(call?.headers.get("authorization")).toBe("Bearer plan-token");
    expect(call?.body).toMatchObject({ store: false, stream: true });
    expect(call?.body).not.toHaveProperty("temperature");
    expect(call?.body).not.toHaveProperty("max_output_tokens");
    expect(JSON.stringify(call?.body)).not.toContain('"role":"system"');
  });

  it("is unconfigured when signed out", () => {
    expect(createOpenAIChatGptProvider({ getAccessToken: () => undefined }).configured).toBe(false);
  });
});
