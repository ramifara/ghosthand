// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The GhostHand MCP server: run_task, run_spec, get_run, get_report, cancel_run, list_recipes, and
// (behind a flag) observe/act. Long runs return a job id at once; progress goes out as logging
// notifications and `get_run` polls. Transport and auth are the caller's choice (ADR 0006: stdio only).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Job, JobRegistry } from "./job-registry.ts";
import type { McpBackend, SpecRunSummary } from "./mcp-backend.ts";

export const MCP_SERVER_NAME = "ghosthand";
export const MCP_SERVER_VERSION = "0.0.0";

export interface CreateServerOptions {
  /** Register the optional `observe` and `act` tools. */
  interactive?: boolean;
  now?: () => Date;
}

export interface GhosthandMcp {
  server: McpServer;
  jobs: JobRegistry;
  close(): Promise<void>;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

const decision = z
  .enum(["jev", "heuristic"])
  .default("jev")
  .describe(
    'Decision model: "jev" (TypeSafe Jev, needs TYPESAFE_API_KEY) or "heuristic" (rule-based plumbing check)',
  );
const waitMs = z
  .number()
  .int()
  .min(0)
  .max(120_000)
  .default(0)
  .describe("Wait up to this many ms for the run to finish before returning (0 = return the job id at once)");

/** Removes inline thumbnails (data URIs) from report JSON so tool results stay small. */
export function stripThumbnails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripThumbnails);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "thumbnail" && typeof v === "string") continue;
      out[k] = stripThumbnails(v);
    }
    return out;
  }
  return value;
}

export function jobView(job: Job): Record<string, unknown> {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    label: job.label,
    createdAt: job.createdAt,
    ...(job.startedAt ? { startedAt: job.startedAt } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    progress: job.progress.slice(-10),
    ...(job.result !== undefined ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

async function waitFor(job: Job, ms: number): Promise<void> {
  if (ms <= 0) return;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && (job.status === "queued" || job.status === "running"))
    await new Promise((r) => setTimeout(r, Math.min(200, Math.max(1, deadline - Date.now()))));
}

export function createGhosthandMcpServer(backend: McpBackend, opts: CreateServerOptions = {}): GhosthandMcp {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      capabilities: { logging: {} },
      instructions:
        "GhostHand drives a real browser. run_task and run_spec return a job id at once; poll get_run until status is done or failed. " +
        "Progress lines also arrive as logging notifications. Results come from oracles and deterministic checks, never from the agent's own claim.",
    },
  );
  const jobs = new JobRegistry({
    ...(opts.now ? { now: opts.now } : {}),
    onProgress: (job, line) => {
      if (!server.isConnected()) return;
      void server
        .sendLoggingMessage({ level: "info", logger: "ghosthand", data: `${job.id}: ${line}` })
        .catch(() => {});
    },
  });

  server.registerTool(
    "run_task",
    {
      title: "Run a task",
      description:
        "Start a GhostHand run in a real browser: a free-text goal on a URL, or a testbed task id. Returns a job id; poll get_run.",
      inputSchema: {
        goal: z.string().min(1).max(2000).optional().describe("What to do, in plain words"),
        url: z.string().url().optional().describe("Start URL (required with goal)"),
        task_id: z
          .string()
          .optional()
          .describe('Testbed task id, e.g. "l1-update-profile" (needs `bun run dev:testbed`)'),
        headless: z.boolean().default(true),
        decision,
        wait_ms: waitMs,
      },
    },
    async (args) => {
      if (!args.task_id && !(args.goal && args.url)) return fail("give task_id, or goal and url");
      const label = args.task_id ? `task ${args.task_id}` : `goal on ${args.url}`;
      const job = jobs.submit("task", label, (ctx) =>
        backend.runTask(
          {
            ...(args.goal ? { goal: args.goal } : {}),
            ...(args.url ? { url: args.url } : {}),
            ...(args.task_id ? { taskId: args.task_id } : {}),
            headless: args.headless,
            decision: args.decision,
          },
          ctx,
        ),
      );
      await waitFor(job, args.wait_ms);
      return text(jobView(job));
    },
  );

  server.registerTool(
    "run_spec",
    {
      title: "Run a QA spec",
      description:
        "Run a Markdown QA spec (front-matter, # Suite, ## Case, numbered **perform**/**expect** steps) and write a scored HTML + JSON report. Returns a job id; poll get_run, then get_report.",
      inputSchema: {
        spec_path: z.string().min(1).describe("Path to the spec .md file"),
        runs: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Runs per case for pass^k (default from the spec)"),
        decision,
        variant: z
          .record(z.string(), z.string())
          .optional()
          .describe('Testbed variant flags, e.g. {"bug":"profile-title"}'),
        headless: z.boolean().default(true),
        out: z.string().optional().describe("HTML report path (JSON next to it)"),
        wait_ms: waitMs,
      },
    },
    async (args) => {
      const job = jobs.submit("spec", `spec ${args.spec_path}`, (ctx) =>
        backend.runSpec(
          {
            specPath: args.spec_path,
            decision: args.decision,
            headless: args.headless,
            ...(args.runs ? { runs: args.runs } : {}),
            ...(args.variant ? { variant: args.variant } : {}),
            ...(args.out ? { out: args.out } : {}),
          },
          ctx,
        ),
      );
      await waitFor(job, args.wait_ms);
      return text(jobView(job));
    },
  );

  server.registerTool(
    "get_run",
    {
      title: "Get a run",
      description: "Status and result of a job from run_task/run_spec, or of any recorded run by its run id.",
      inputSchema: { id: z.string().min(1).describe("Job id (job-…) or run id") },
    },
    async ({ id }) => {
      const job = jobs.get(id);
      if (job) return text(jobView(job));
      const stored = backend.getStoredRun(id);
      return stored.ok ? text(stored.value) : fail(`no job or run "${id}": ${stored.error}`);
    },
  );

  server.registerTool(
    "get_report",
    {
      title: "Get a QA report",
      description:
        'The report of a finished run_spec job: "summary" (verdict, score, paths) or "json" (full report without inline thumbnails).',
      inputSchema: {
        id: z.string().min(1).describe("Job id of a run_spec job"),
        format: z.enum(["summary", "json"]).default("summary"),
      },
    },
    async ({ id, format }) => {
      const job = jobs.get(id);
      if (job?.kind !== "spec") return fail(`no run_spec job "${id}"`);
      if (job.status !== "done")
        return fail(`job ${id} is ${job.status}${job.error ? `: ${job.error}` : ""}`);
      const summary = job.result as SpecRunSummary;
      if (format === "summary") return text(summary);
      const r = backend.readReport(summary.jsonPath);
      return r.ok ? text(stripThumbnails(r.value)) : fail(r.error);
    },
  );

  server.registerTool(
    "cancel_run",
    {
      title: "Cancel a run",
      description: "Abort a queued or running job.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) =>
      jobs.cancel(id) ? text({ id, cancelled: true }) : fail(`job "${id}" is not queued or running`),
  );

  server.registerTool(
    "list_recipes",
    {
      title: "List recipes",
      description: "Saved recipes (replayable flows). Empty until recipes arrive with Phase 3 knowledge.",
      inputSchema: {},
    },
    async () =>
      text({
        recipes: backend.listRecipes(),
        note: "Recipes arrive with Phase 3 (knowledge); the list is empty until then.",
      }),
  );

  if (opts.interactive && backend.observe && backend.act) {
    const observe = backend.observe.bind(backend);
    const act = backend.act.bind(backend);
    server.registerTool(
      "observe",
      {
        title: "Observe the page",
        description:
          "Open (or keep) an interactive browser session and return its element table. Element ids are valid until the next observe.",
        inputSchema: { url: z.string().url().optional(), headless: z.boolean().default(true) },
      },
      async (args) => {
        const r = await observe({ ...(args.url ? { url: args.url } : {}), headless: args.headless });
        return r.ok ? text(r.value) : fail(r.error);
      },
    );
    server.registerTool(
      "act",
      {
        title: "Act on an element",
        description:
          "Press, toggle, focus, fill or select an element from the last observe. Secrets are typed by name (secret), never by value.",
        inputSchema: {
          op: z.enum(["press", "toggle", "focus", "set_value", "select_option"]),
          id: z.string().min(1),
          text: z.string().optional(),
          secret: z.string().optional().describe("Name of a stored secret to type, e.g. TESTBED_PASSWORD"),
          option: z.string().optional(),
        },
      },
      async (args) => {
        if (args.op === "select_option" && args.option === undefined)
          return fail("select_option needs option");
        if (args.op === "set_value" && args.text === undefined && args.secret === undefined)
          return fail("set_value needs text or secret");
        const input =
          args.op === "set_value"
            ? {
                op: args.op,
                id: args.id,
                ...(args.text !== undefined ? { text: args.text } : {}),
                ...(args.secret ? { secret: args.secret } : {}),
              }
            : args.op === "select_option"
              ? { op: args.op, id: args.id, option: args.option ?? "" }
              : { op: args.op, id: args.id };
        const r = await act(input);
        return r.ok ? text(r.value) : fail(r.error);
      },
    );
  }

  return {
    server,
    jobs,
    async close() {
      for (const j of jobs.list()) jobs.cancel(j.id);
      await server.close();
      await backend.close?.();
    },
  };
}
