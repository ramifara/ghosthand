// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// MCP smoke on the live testbed: the real engine backend behind the MCP server, an in-memory MCP client
// calling run_task (testbed task, heuristic decisions by default) and polling get_run until it finishes.
// Needs `bun run dev:testbed`. With `--jev` it uses TypeSafe Jev (needs TYPESAFE_API_KEY, costs money).
import { openRuntime } from "@ghosthand/engine";
import { createEngineBackend, createGhosthandMcpServer } from "@ghosthand/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const taskId = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "l1-update-profile";
const decision = process.argv.includes("--jev") ? "jev" : "heuristic";

const rt = await openRuntime({ logLevel: "warn" });
if (!rt.ok) throw new Error(rt.error.message);
const mcp = createGhosthandMcpServer(createEngineBackend(rt.value));
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "mcp-smoke", version: "0.0.0" });
client.fallbackNotificationHandler = async (n) => {
  if (n.method === "notifications/message")
    console.error(`  progress: ${String((n.params as { data?: unknown }).data)}`);
};
await mcp.server.connect(serverSide);
await client.connect(clientSide);

const textOf = (r: unknown): string =>
  ((r as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log(`tools: ${tools.join(", ")}`);
const started = JSON.parse(
  textOf(await client.callTool({ name: "run_task", arguments: { task_id: taskId, decision } })),
) as { id: string; status: string };
console.log(`run_task → ${started.id} (${started.status})`);
let job: { status: string; result?: unknown; error?: string } = started;
const t0 = Date.now();
while (job.status === "queued" || job.status === "running") {
  await new Promise((r) => setTimeout(r, 500));
  job = JSON.parse(textOf(await client.callTool({ name: "get_run", arguments: { id: started.id } })));
  if (Date.now() - t0 > 180_000) break;
}
console.log(`get_run → ${JSON.stringify(job, null, 2)}`);
await mcp.close();
process.exitCode = job.status === "done" ? 0 : 1;
