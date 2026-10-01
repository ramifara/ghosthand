// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createGhosthandMcpServer, type GhosthandMcp, stripThumbnails } from "./create-server.ts";
import { JobRegistry } from "./job-registry.ts";
import type { McpBackend, SpecRunInput, TaskRunInput } from "./mcp-backend.ts";

function fakeBackend(calls: { tasks: TaskRunInput[]; specs: SpecRunInput[] }): McpBackend {
  return {
    async runTask(input, ctx) {
      calls.tasks.push(input);
      ctx.progress("step 1: confirmed");
      if (input.taskId === "boom") return { ok: false, error: "testbed down" };
      return {
        ok: true,
        value: {
          runId: "20260101-000000-abcdef",
          folder: "/tmp/runs/x",
          outcome: "success",
          reason: "all subgoals done",
          oraclePass: true,
          steps: 3,
          wallMs: 1200,
          costUsd: 0.0004,
          decisionCalls: 4,
        },
      };
    },
    async runSpec(input, ctx) {
      calls.specs.push(input);
      ctx.progress("Profile / Update: preflight 1:ok×3");
      return {
        ok: true,
        value: {
          verdict: "FAIL",
          score: 41,
          summaryLine: "[qa] verdict FAIL",
          htmlPath: "/tmp/r.html",
          jsonPath: "/tmp/r.json",
          plantedBugs: [{ flag: "profile-title", active: true, caught: true }],
        },
      };
    },
    getStoredRun: (id) =>
      id === "old-run"
        ? {
            ok: true,
            value: {
              runId: id,
              folder: "/f",
              taskId: "l1-login",
              outcome: "success",
              steps: 2,
              costUsd: 0,
              startedAt: 1,
            },
          }
        : { ok: false, error: "not found" },
    readReport: () => ({
      ok: true,
      value: { verdict: "FAIL", cases: [{ runs: [{ finalEvidence: { thumbnail: "data:x" } }] }] },
    }),
    listRecipes: () => [],
    observe: async () => ({
      ok: true,
      value: {
        url: "http://x/",
        title: "X",
        elements: [{ id: "e1", role: "button", name: "Go", ops: ["press"] }],
      },
    }),
    act: async (input) => ({ ok: true, value: { effect: "confirmed", detail: input.op } }),
  };
}

let mcp: GhosthandMcp | undefined;
afterEach(async () => {
  await mcp?.close();
  mcp = undefined;
});

async function connect(interactive = false) {
  const calls = { tasks: [] as TaskRunInput[], specs: [] as SpecRunInput[] };
  mcp = createGhosthandMcpServer(fakeBackend(calls), { interactive });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const logs: string[] = [];
  const client = new Client({ name: "test", version: "0.0.0" });
  await mcp.server.connect(serverT);
  await client.connect(clientT);
  client.fallbackNotificationHandler = async (n) => {
    if (n.method === "notifications/message") logs.push(String((n.params as { data?: unknown }).data));
  };
  return { client, calls, logs, mcp };
}

const textOf = (r: unknown): string => {
  const content = (r as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("");
};
const json = (r: unknown): Record<string, unknown> => JSON.parse(textOf(r)) as Record<string, unknown>;

describe("ghosthand MCP server", () => {
  it("lists the tools; observe/act only behind the flag", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["cancel_run", "get_report", "get_run", "list_recipes", "run_spec", "run_task"]);
    await mcp?.close();
    const second = await connect(true);
    const all = (await second.client.listTools()).tools.map((t) => t.name);
    expect(all).toContain("observe");
    expect(all).toContain("act");
  });

  it("run_task returns a job id at once, then get_run polls it to done", async () => {
    const { client, calls, mcp: server, logs } = await connect();
    const started = json(
      await client.callTool({ name: "run_task", arguments: { task_id: "l1-login", decision: "heuristic" } }),
    );
    expect(started.id).toMatch(/^job-/);
    expect(["queued", "running", "done"]).toContain(started.status);
    await server.jobs.idle();
    const done = json(await client.callTool({ name: "get_run", arguments: { id: started.id } }));
    expect(done.status).toBe("done");
    expect((done.result as { oraclePass: boolean }).oraclePass).toBe(true);
    expect(calls.tasks[0]).toEqual({ taskId: "l1-login", headless: true, decision: "heuristic" });
    await new Promise((r) => setTimeout(r, 10));
    expect(logs.some((l) => l.endsWith("step 1: confirmed"))).toBe(true);
  });

  it("run_task with wait_ms returns the finished job, and failures surface as failed", async () => {
    const { client } = await connect();
    const r = json(
      await client.callTool({ name: "run_task", arguments: { task_id: "boom", wait_ms: 2000 } }),
    );
    expect(r.status).toBe("failed");
    expect(r.error).toBe("testbed down");
    const bad = await client.callTool({ name: "run_task", arguments: { goal: "do it" } });
    expect(bad.isError).toBe(true);
  });

  it("run_spec then get_report (summary and json without thumbnails)", async () => {
    const { client, calls } = await connect();
    const job = json(
      await client.callTool({
        name: "run_spec",
        arguments: {
          spec_path: "apps/testbed/specs/profile.md",
          variant: { bug: "profile-title" },
          wait_ms: 2000,
        },
      }),
    );
    expect(job.status).toBe("done");
    expect(calls.specs[0]).toMatchObject({
      specPath: "apps/testbed/specs/profile.md",
      variant: { bug: "profile-title" },
      decision: "jev",
    });
    const summary = json(await client.callTool({ name: "get_report", arguments: { id: job.id } }));
    expect(summary.verdict).toBe("FAIL");
    const full = textOf(
      await client.callTool({ name: "get_report", arguments: { id: job.id, format: "json" } }),
    );
    expect(full).not.toContain("thumbnail");
  });

  it("get_run falls back to the run index; list_recipes is empty", async () => {
    const { client } = await connect();
    expect(json(await client.callTool({ name: "get_run", arguments: { id: "old-run" } })).taskId).toBe(
      "l1-login",
    );
    expect((await client.callTool({ name: "get_run", arguments: { id: "nope" } })).isError).toBe(true);
    expect(json(await client.callTool({ name: "list_recipes", arguments: {} })).recipes).toEqual([]);
  });

  it("observe and act go to the backend", async () => {
    const { client } = await connect(true);
    const seen = json(await client.callTool({ name: "observe", arguments: { url: "http://x/" } }));
    expect((seen.elements as unknown[]).length).toBe(1);
    const acted = json(await client.callTool({ name: "act", arguments: { op: "press", id: "e1" } }));
    expect(acted.effect).toBe("confirmed");
    expect((await client.callTool({ name: "act", arguments: { op: "set_value", id: "e1" } })).isError).toBe(
      true,
    );
  });
});

describe("JobRegistry", () => {
  it("runs jobs one at a time in order and supports cancel", async () => {
    const order: string[] = [];
    const jobs = new JobRegistry();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const a = jobs.submit("task", "a", async () => {
      order.push("a-start");
      await gate;
      order.push("a-end");
      return { ok: true, value: 1 };
    });
    const b = jobs.submit("task", "b", async () => {
      order.push("b");
      return { ok: true, value: 2 };
    });
    const c = jobs.submit("task", "c", async () => ({ ok: true, value: 3 }));
    expect(jobs.cancel(c.id)).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(a.status).toBe("running");
    expect(b.status).toBe("queued");
    release();
    await jobs.idle();
    expect(order).toEqual(["a-start", "a-end", "b"]);
    expect([a.status, b.status, c.status]).toEqual(["done", "done", "cancelled"]);
  });

  it("strips inline thumbnails", () => {
    expect(stripThumbnails({ a: [{ thumbnail: "data:x", b: 1 }] })).toEqual({ a: [{ b: 1 }] });
  });
});
