// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import {
  EngineMessage,
  HostRequest,
  IPC_COMMAND_NAMES,
  IpcCommands,
  isIpcCommandName,
  PushMessage,
  parseIpcRequest,
  Settings,
  StartRunInput,
} from "./ipc.ts";

describe("parseIpcRequest", () => {
  it("rejects unknown commands and prototype keys", () => {
    for (const name of ["nope", "__proto__", "constructor", "toString", 42, undefined]) {
      const r = parseIpcRequest(name, {});
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("unknown_command");
    }
    expect(isIpcCommandName("runs.start")).toBe(true);
  });

  it("accepts empty input for no-argument commands", () => {
    for (const name of ["app.info", "tasks.list", "settings.get", "runs.active"] as const) {
      expect(parseIpcRequest(name, undefined).ok).toBe(true);
      expect(parseIpcRequest(name, {}).ok).toBe(true);
    }
  });

  it("rejects extra keys (strict objects)", () => {
    const r = parseIpcRequest("tasks.list", { evil: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("invalid_input");
  });

  it("validates a testbed run start and fills defaults", () => {
    const r = parseIpcRequest("runs.start", { source: { kind: "testbed", taskId: "l1-login" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.input).toMatchObject({ decision: "jev" });
  });

  it("rejects non-http start URLs, bad task ids and path-like run ids", () => {
    const bad: Array<[string, unknown]> = [
      ["runs.start", { source: { kind: "goal", goal: "x", startUrl: "file:///etc/passwd" } }],
      ["runs.start", { source: { kind: "goal", goal: "x", startUrl: "javascript:alert(1)" } }],
      ["runs.start", { source: { kind: "testbed", taskId: "../../etc" } }],
      ["runs.start", { source: { kind: "goal", goal: "   ", startUrl: "https://example.com" } }],
      ["runs.get", { runId: "../x" }],
      ["runs.get", { runId: ".hidden" }],
      ["runs.screenshot", { runId: "20260101-000000-abcdef", step: -1 }],
      ["profiles.create", { name: "Bad Name" }],
      ["secrets.set", { name: "lowercase", value: "x" }],
      ["secrets.set", { name: "OK_NAME", value: "" }],
      ["shell.openExternal", { url: "file:///tmp/x" }],
      ["roles.set", { planner: { models: ["no-slash"] } }],
      ["roles.set", { decision: { models: ["openai/gpt-6-sol"] } }],
    ];
    for (const [cmd, input] of bad) {
      const r = parseIpcRequest(cmd, input);
      expect(r.ok, `${cmd} ${JSON.stringify(input)}`).toBe(false);
    }
  });

  it("every command has input and output schemas", () => {
    expect(IPC_COMMAND_NAMES.length).toBeGreaterThan(25);
    for (const name of IPC_COMMAND_NAMES) {
      expect(IpcCommands[name].input).toBeDefined();
      expect(IpcCommands[name].output).toBeDefined();
    }
  });

  it("never carries secret values out: secrets.list returns names only", () => {
    const shape = IpcCommands["secrets.list"].output.shape;
    expect(Object.keys(shape).sort()).toEqual(["backend", "names", "persistent", "warning"]);
  });
});

describe("settings", () => {
  it("defaults are complete and the dev plumbing mode is off", () => {
    const s = Settings.parse({});
    expect(s.devPlumbingMode).toBe(false);
    expect(s.chatgptSignIn).toBe(false);
    expect(s.defaultProfile).toBe("default");
  });
  it("patches are partial and strict", () => {
    expect(parseIpcRequest("settings.set", { showBrowser: false }).ok).toBe(true);
    expect(parseIpcRequest("settings.set", { unknown: true }).ok).toBe(false);
  });
});

describe("engine and push messages", () => {
  it("parses a screencast frame and a status message", () => {
    const frame = EngineMessage.parse({
      kind: "frame",
      runId: "r",
      frame: {
        data: "AAAA",
        mimeType: "image/jpeg",
        metadata: {
          deviceWidth: 1280,
          deviceHeight: 860,
          offsetTop: 0,
          pageScaleFactor: 1,
          scrollOffsetX: 0,
          scrollOffsetY: 0,
        },
      },
    });
    expect(frame.kind).toBe("frame");
    expect(EngineMessage.safeParse({ kind: "status", runId: "r", status: "paused" }).success).toBe(true);
    expect(EngineMessage.safeParse({ kind: "status", runId: "r", status: "weird" }).success).toBe(false);
  });

  it("parses push messages", () => {
    expect(PushMessage.safeParse({ kind: "hotkey", action: "takeover-toggle" }).success).toBe(true);
    expect(PushMessage.safeParse({ kind: "engine", state: "ready" }).success).toBe(true);
  });

  it("host requests only name known host commands", () => {
    const req = { kind: "request", id: 1, command: "runs.list", input: {} };
    expect(HostRequest.safeParse(req).success).toBe(true);
    expect(HostRequest.safeParse({ ...req, command: "secrets.set" }).success).toBe(false);
  });

  it("start input allows a goal with origins", () => {
    const r = StartRunInput.parse({
      source: {
        kind: "goal",
        goal: "Find the pricing page",
        startUrl: "https://example.com",
        allowOrigins: ["https://cdn.example.com"],
      },
      decision: "heuristic",
    });
    expect(r.source.kind).toBe("goal");
  });
});
