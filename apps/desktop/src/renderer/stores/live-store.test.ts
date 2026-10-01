// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { RunEvent } from "@ghosthand/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { useLiveStore } from "./live-store.ts";

const ev = (runId: string, seq: number): RunEvent =>
  ({ t: seq, seq, runId, type: "subgoal.start", subgoalId: "g", goal: "x" }) as RunEvent;
const meta = {
  deviceWidth: 1280,
  deviceHeight: 860,
  offsetTop: 0,
  pageScaleFactor: 1,
  scrollOffsetX: 0,
  scrollOffsetY: 0,
};

describe("live store", () => {
  beforeEach(() => useLiveStore.getState().reset());

  it("collects events per run and starts over for a new run", () => {
    const s = useLiveStore.getState();
    s.ingest({ kind: "run.event", runId: "a", event: ev("a", 0) });
    s.ingest({ kind: "run.event", runId: "a", event: ev("a", 1) });
    expect(useLiveStore.getState().events).toHaveLength(2);
    s.ingest({ kind: "run.event", runId: "b", event: ev("b", 0) });
    expect(useLiveStore.getState()).toMatchObject({ runId: "b", status: "running" });
    expect(useLiveStore.getState().events).toHaveLength(1);
  });

  it("keeps only the latest frame of the current run", () => {
    const s = useLiveStore.getState();
    s.ingest({ kind: "status", runId: "a", status: "running" });
    s.ingest({ kind: "frame", runId: "a", frame: { data: "AAA", mimeType: "image/jpeg", metadata: meta } });
    s.ingest({ kind: "frame", runId: "zzz", frame: { data: "BBB", mimeType: "image/jpeg", metadata: meta } });
    expect(useLiveStore.getState().frame?.src).toBe("data:image/jpeg;base64,AAA");
  });

  it("tracks approvals and clears them when the run ends", () => {
    const s = useLiveStore.getState();
    s.ingest({ kind: "status", runId: "a", status: "running" });
    const request = {
      requestId: "a1",
      step: 2,
      actionType: "press",
      target: null,
      effect: "commit" as const,
      goal: "g",
      describe: "press x",
    };
    s.ingest({ kind: "approval.request", runId: "a", request });
    expect(useLiveStore.getState().approval?.requestId).toBe("a1");
    s.ingest({ kind: "approval.resolved", runId: "a", requestId: "a1", decision: "once" });
    expect(useLiveStore.getState().approval).toBeUndefined();
    expect(useLiveStore.getState().approvals).toEqual([
      { requestId: "a1", decision: "once", step: 2, describe: "press x" },
    ]);
    s.ingest({ kind: "approval.request", runId: "a", request: { ...request, requestId: "a2" } });
    s.ingest({ kind: "status", runId: "a", status: "ended", outcome: "success", oraclePass: true });
    expect(useLiveStore.getState()).toMatchObject({
      status: "ended",
      outcome: "success",
      oraclePass: true,
      approval: undefined,
    });
  });
});
