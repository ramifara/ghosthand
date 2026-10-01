// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { IPC_COMMAND_NAMES, type IpcCommandName } from "@ghosthand/protocol";
import { describe, expect, it, vi } from "vitest";
import { createIpcRouter, type IpcHandlers } from "./ipc-router.ts";

const trusted = { url: "app://ghosthand/index.html", isMainFrame: true };

function handlers(overrides: Partial<Record<IpcCommandName, (input: unknown) => Promise<unknown>>> = {}) {
  const all: Record<string, (input: unknown) => Promise<unknown>> = {};
  for (const name of IPC_COMMAND_NAMES)
    all[name] = overrides[name] ?? (async () => ({ ok: true, value: null }));
  return all as unknown as IpcHandlers;
}

describe("ipc router", () => {
  it("refuses untrusted senders before parsing", async () => {
    const spy = vi.fn(async () => ({ ok: true, value: null }));
    const router = createIpcRouter({ handlers: handlers({ "settings.get": spy }), policy: {} });
    const r = await router.handle({ url: "https://evil.example/", isMainFrame: true }, "settings.get", {});
    expect(r).toEqual({ ok: false, error: { kind: "forbidden_sender", message: "untrusted sender" } });
    expect(spy).not.toHaveBeenCalled();
  });

  it("validates input and passes the parsed value", async () => {
    const spy = vi.fn(async (input: unknown) => ({ ok: true, value: input }));
    const router = createIpcRouter({ handlers: handlers({ "runs.start": spy }), policy: {} });
    const bad = await router.handle(trusted, "runs.start", { source: { kind: "testbed", taskId: "../x" } });
    expect(bad.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    const good = await router.handle(trusted, "runs.start", {
      source: { kind: "testbed", taskId: "l1-login" },
    });
    expect(good.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith({ source: { kind: "testbed", taskId: "l1-login" }, decision: "jev" });
  });

  it("turns handler exceptions into an internal error without the message", async () => {
    const problems: string[] = [];
    const router = createIpcRouter({
      handlers: handlers({
        "tasks.list": async () => {
          throw new Error("secret path /home/x/.config");
        },
      }),
      policy: {},
      onProblem: (p) => problems.push(p.kind),
    });
    const r = await router.handle(trusted, "tasks.list", {});
    expect(r).toEqual({ ok: false, error: { kind: "internal", message: "tasks.list failed" } });
    expect(problems).toEqual(["internal"]);
  });

  it("rejects unknown commands", async () => {
    const router = createIpcRouter({ handlers: handlers(), policy: {} });
    expect((await router.handle(trusted, "eval", "1+1")).ok).toBe(false);
  });
});
