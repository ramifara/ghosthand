// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostCommandName, IpcResponse } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import type { ChatGptAuth } from "./chatgpt/chatgpt-auth.ts";
import type { RequestExtras } from "./engine-host-client.ts";
import { createMainHandlers } from "./main-handlers.ts";
import { type SafeStorageLike, SecretStore } from "./secret-store.ts";
import { SettingsStore } from "./settings-store.ts";

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
  getSelectedStorageBackend: () => "kwallet6",
};

function setup(hostAnswer: (command: HostCommandName, input: unknown) => IpcResponse<unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "gh-handlers-"));
  const settings = new SettingsStore(join(dir, "settings.json"));
  const secrets = new SecretStore({ file: join(dir, "secrets.json"), safeStorage, platform: "linux" });
  const calls: Array<{ command: HostCommandName; input: unknown; extras: RequestExtras }> = [];
  const opened: string[] = [];
  const started: string[] = [];
  let logsOpened = 0;
  const chatgpt = {
    accessToken: async () => "plan-token",
    status: () => ({ enabled: true, signedIn: true, pending: false, scopes: [] }),
    cancel: () => ({ enabled: false, signedIn: false, pending: false, scopes: [] }),
  } as unknown as ChatGptAuth;
  const handlers = createMainHandlers({
    settings,
    secrets,
    chatgpt,
    host: {
      request: async (command, input, extras = {}) => {
        calls.push({ command, input, extras });
        return hostAnswer(command, input);
      },
    },
    openExternal: async (url) => {
      opened.push(url);
    },
    openLogs: async () => {
      logsOpened++;
    },
    app: {
      version: "0.0.0",
      platform: "linux",
      electron: "43.7.7",
      packaged: true,
      logsDir: join(dir, "logs"),
    },
    onRunStarted: (id) => started.push(id),
  });
  return { handlers, settings, secrets, calls, opened, started, logsOpened: () => logsOpened, dir };
}

describe("main handlers", () => {
  it("refuses heuristic runs unless plumbing mode is on", async () => {
    const { handlers, settings, calls } = setup(() => ({ ok: true, value: { runId: "r1" } }));
    const input = {
      source: { kind: "testbed" as const, taskId: "l1-login" },
      decision: "heuristic" as const,
    };
    expect(await handlers["runs.start"](input)).toMatchObject({
      ok: false,
      error: { kind: "invalid_input" },
    });
    expect(calls).toHaveLength(0);
    settings.patch({ devPlumbingMode: true });
    expect(await handlers["runs.start"](input)).toEqual({ ok: true, value: { runId: "r1" } });
  });

  it("attaches settings and credentials to runs.start, and reports the started run", async () => {
    const { handlers, secrets, calls, started } = setup(() => ({ ok: true, value: { runId: "r2" } }));
    secrets.set("TYPESAFE_API_KEY", "ts-1");
    await handlers["runs.start"]({ source: { kind: "testbed", taskId: "l1-login" }, decision: "jev" });
    expect(calls[0]?.extras.credentials).toEqual({
      secrets: { TYPESAFE_API_KEY: "ts-1" },
      chatgptAccessToken: "plan-token",
    });
    expect(calls[0]?.extras.settings?.planner).toBe("auto");
    expect(started).toEqual(["r2"]);
  });

  it("does not send credentials with history queries", async () => {
    const { handlers, calls } = setup(() => ({ ok: true, value: [] }));
    await handlers["runs.list"]({});
    expect(calls[0]?.extras.credentials).toBeUndefined();
  });

  it("rejects host answers that do not match the output schema", async () => {
    const { handlers } = setup(() => ({ ok: true, value: [{ id: 1 }] }));
    expect(await handlers["tasks.list"]({})).toMatchObject({ ok: false, error: { kind: "engine" } });
  });

  it("returns secret names only", async () => {
    const { handlers } = setup(() => ({ ok: true, value: null }));
    const r = await handlers["secrets.set"]({ name: "SITE_PASSWORD", value: "pw-123" });
    expect(r).toEqual({
      ok: true,
      value: { names: ["SITE_PASSWORD"], backend: "kwallet6", persistent: true },
    });
    expect(JSON.stringify(r)).not.toContain("pw-123");
  });

  it("validates role bindings against the catalog", async () => {
    const { handlers, settings } = setup(() => ({ ok: true, value: null }));
    const bad = await handlers["roles.set"]({ planner: { models: ["openai/does-not-exist"] } });
    expect(bad).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    const good = await handlers["roles.set"]({ writer: { models: ["openai/gpt-6-luna"] } });
    expect(good.ok).toBe(true);
    expect(settings.get().roleBindings.writer?.models).toEqual(["openai/gpt-6-luna"]);
  });

  it("reports the build kind and logs folder, and opens the logs folder on request", async () => {
    const { handlers, dir, logsOpened } = setup(() => ({ ok: true, value: "/runs" }));
    expect(await handlers["app.info"]({})).toMatchObject({
      ok: true,
      value: { packaged: true, logsDir: join(dir, "logs"), runsDir: "/runs" },
    });
    expect(await handlers["app.openLogs"]({})).toEqual({ ok: true, value: null });
    expect(logsOpened()).toBe(1);
  });

  it("opens only allow-listed links", async () => {
    const { handlers, opened } = setup(() => ({ ok: true, value: null }));
    expect((await handlers["shell.openExternal"]({ url: "https://example.com" })).ok).toBe(false);
    expect((await handlers["shell.openExternal"]({ url: "https://help.openai.com/x" })).ok).toBe(true);
    expect(opened).toEqual(["https://help.openai.com/x"]);
  });
});
