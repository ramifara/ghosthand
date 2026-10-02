// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Frame throttling, view mappings and the screencast capability check.
import { RunListItem } from "@ghosthand/protocol";
import type { RunRecord } from "@ghosthand/recorder";
import { describe, expect, it } from "vitest";
import { FrameThrottle } from "./frame-throttle.ts";
import { invalidRequestResponse } from "./host-service.ts";
import { defaultChromeUserDataDir, toProfileItem, toRunListItem } from "./host-views.ts";
import { createIpcErrorFromProfile, isScreencastCapable } from "./screencast-capable.ts";

describe("FrameThrottle", () => {
  it("sends the first frame at once and coalesces a burst to the newest", async () => {
    let now = 0;
    const sent: number[] = [];
    const t = new FrameThrottle<number>((f) => sent.push(f), { intervalMs: 50, now: () => now });
    t.push(1);
    t.push(2);
    t.push(3);
    expect(sent).toEqual([1]);
    now = 60;
    await new Promise((r) => setTimeout(r, 80));
    expect(sent).toEqual([1, 3]);
    t.dispose();
  });

  it("drops pending frames on dispose", async () => {
    const sent: number[] = [];
    const t = new FrameThrottle<number>((f) => sent.push(f), { intervalMs: 30 });
    t.push(1);
    t.push(2);
    t.dispose();
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toEqual([1]);
  });
});

describe("views", () => {
  it("drops the folder path from run rows", () => {
    const record: RunRecord = {
      id: "20261001-120000-abcdef",
      startedAt: 1,
      endedAt: 2,
      taskId: "l1-login",
      instruction: "Sign in",
      startUrl: "http://127.0.0.1:4400/login",
      outcome: "success",
      reason: "ok",
      steps: 3,
      wallMs: 4000,
      costUsd: 0,
      decisionCalls: 3,
      modelCalls: 0,
      decisionModel: "heuristic",
      gitSha: "abc",
      folder: "/home/user/.local/share/ghosthand/runs/x",
    };
    const item = toRunListItem(record);
    expect(RunListItem.parse(item)).toEqual(item);
    expect(JSON.stringify(item)).not.toContain("/home/user");
  });

  it("maps profiles", () => {
    expect(toProfileItem({ name: "work", metadata: { importedFrom: "/x" } })).toEqual({
      name: "work",
      sizeBytes: 0,
      importedFrom: "/x",
    });
  });

  it("knows Chrome's user-data-dir per platform", () => {
    expect(defaultChromeUserDataDir("linux", {}, "/home/a")).toBe("/home/a/.config/google-chrome");
    expect(defaultChromeUserDataDir("darwin", {}, "/Users/a")).toBe(
      "/Users/a/Library/Application Support/Google/Chrome",
    );
    expect(defaultChromeUserDataDir("win32", { LOCALAPPDATA: "C:\\L" }, "C:\\U")).toBe(
      "C:\\L\\Google\\Chrome\\User Data",
    );
  });

  it("maps profile errors to IPC errors", () => {
    expect(createIpcErrorFromProfile({ kind: "profile_locked", message: "m" }).error.kind).toBe("busy");
    expect(createIpcErrorFromProfile({ kind: "profile_exists", message: "m" }).error.kind).toBe(
      "invalid_input",
    );
  });

  it("detects screencast-capable computers", () => {
    const base = {} as Parameters<typeof isScreencastCapable>[0];
    expect(isScreencastCapable(base)).toBe(false);
    expect(
      isScreencastCapable({
        ...base,
        startScreencast: async () => {},
        stopScreencast: async () => {},
      } as typeof base),
    ).toBe(true);
  });
});

describe("invalidRequestResponse", () => {
  it("answers a malformed request that carries an id, so main does not wait for its timeout", () => {
    const res = invalidRequestResponse(
      { kind: "request", id: 7, command: "runs.start" },
      "settings: invalid",
    );
    expect(res).toEqual({
      kind: "response",
      id: 7,
      ok: false,
      error: { kind: "invalid_input", message: "the engine host rejected the request (settings: invalid)" },
    });
  });

  it("ignores messages without a request id", () => {
    expect(invalidRequestResponse({ kind: "port" })).toBeUndefined();
    expect(invalidRequestResponse("nonsense")).toBeUndefined();
  });
});
