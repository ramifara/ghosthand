// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { jsonFetch } from "../__fixtures__/json-fetch.ts";
import { DEFAULT_LOCAL_SERVERS, discoverLocalModels, localModelOverrides } from "./local-discovery.ts";

describe("discoverLocalModels", () => {
  it("only contacts the given URLs and lists /models ids", async () => {
    const http = jsonFetch((url) => {
      if (url.startsWith("http://127.0.0.1:11434/")) {
        return {
          body: { object: "list", data: [{ id: "qwen3:8b" }, { id: "llama3.2:3b" }, { id: "qwen3:8b" }] },
        };
      }
      return new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:1234") });
    });
    const found = await discoverLocalModels({ servers: DEFAULT_LOCAL_SERVERS, fetch: http.fetch });
    expect(http.calls.map((c) => c.url)).toEqual([
      "http://127.0.0.1:11434/v1/models",
      "http://127.0.0.1:1234/v1/models",
    ]);
    expect(found[0]).toMatchObject({ id: "ollama", reachable: true, models: ["llama3.2:3b", "qwen3:8b"] });
    expect(found[1]).toMatchObject({ id: "lmstudio", reachable: false, models: [], error: "fetch failed" });
  });

  it("reports HTTP errors and odd bodies as reachable but unusable, and sends a configured key", async () => {
    const http = jsonFetch((url) =>
      url.includes(":8000") ? { status: 401, body: { error: "no" } } : { body: { models: [] } },
    );
    const found = await discoverLocalModels({
      servers: [
        { id: "vllm", baseURL: "http://127.0.0.1:8000/v1/", apiKey: "local-token" },
        { id: "llamacpp", baseURL: "http://127.0.0.1:8080/v1" },
      ],
      fetch: http.fetch,
    });
    expect(http.calls[0]?.url).toBe("http://127.0.0.1:8000/v1/models");
    expect(http.calls[0]?.headers.authorization).toBe("Bearer local-token");
    expect(http.calls[1]?.headers.authorization).toBeUndefined();
    expect(found[0]).toMatchObject({ reachable: true, models: [], error: "HTTP 401" });
    expect(found[1]).toMatchObject({ reachable: true, models: [], error: "unexpected /models body" });
  });

  it("turns discovered models into free, text-only catalog overrides", () => {
    const overrides = localModelOverrides([
      { id: "lmstudio", baseURL: "x", reachable: true, models: ["gemma-4"], latencyMs: 2 },
      { id: "ollama", baseURL: "y", reachable: false, models: [], latencyMs: 2 },
    ]);
    expect(overrides).toEqual([
      expect.objectContaining({
        ref: "lmstudio/gemma-4",
        inputModalities: ["text"],
        pricing: { inputPerM: 0, outputPerM: 0 },
      }),
    ]);
  });
});
