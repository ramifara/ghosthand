// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Live run state fed by the engine MessagePort: events, the latest screencast frame, approvals, status.
import type {
  ApprovalDecision,
  ApprovalRequestView,
  EngineMessage,
  RunEvent,
  RunOutcome,
  RunStatus,
  ScreencastMetadata,
} from "@ghosthand/protocol";
import { create } from "zustand";

export type EngineState = "unknown" | "ready" | "crashed" | "restarting";

export interface LiveFrame {
  src: string;
  meta: ScreencastMetadata;
  at: number;
}

export interface LiveState {
  runId: string | undefined;
  status: RunStatus | undefined;
  detail: string | undefined;
  outcome: RunOutcome | undefined;
  oraclePass: boolean | undefined;
  events: RunEvent[];
  frame: LiveFrame | undefined;
  approval: ApprovalRequestView | undefined;
  approvals: Array<{ requestId: string; decision: ApprovalDecision; step?: number; describe?: string }>;
  engine: EngineState;
  ingest(message: EngineMessage): void;
  setEngine(state: EngineState): void;
  reset(): void;
}

const blank = {
  runId: undefined,
  status: undefined,
  detail: undefined,
  outcome: undefined,
  oraclePass: undefined,
  events: [] as RunEvent[],
  frame: undefined,
  approval: undefined,
  approvals: [] as LiveState["approvals"],
};

export const useLiveStore = create<LiveState>((set, get) => ({
  ...blank,
  engine: "unknown",
  setEngine: (engine) => set({ engine }),
  reset: () => set({ ...blank }),
  ingest(message) {
    const s = get();
    switch (message.kind) {
      case "hello":
        set({ engine: "ready" });
        return;
      case "run.event": {
        if (s.runId !== message.runId) {
          set({ ...blank, runId: message.runId, status: "running", events: [message.event] });
          return;
        }
        set({ events: [...s.events, message.event] });
        return;
      }
      case "frame":
        if (s.runId !== undefined && s.runId !== message.runId) return;
        set({
          frame: {
            src: `data:${message.frame.mimeType};base64,${message.frame.data}`,
            meta: message.frame.metadata,
            at: Date.now(),
          },
        });
        return;
      case "status": {
        const fresh = s.runId !== message.runId;
        set({
          ...(fresh ? { ...blank, runId: message.runId } : {}),
          status: message.status,
          detail: message.detail,
          ...(message.outcome ? { outcome: message.outcome } : {}),
          ...(message.oraclePass !== undefined ? { oraclePass: message.oraclePass } : {}),
          ...(message.status === "ended" ? { approval: undefined } : {}),
        });
        return;
      }
      case "approval.request":
        set({ approval: message.request });
        return;
      case "approval.resolved": {
        const pending = s.approval?.requestId === message.requestId ? s.approval : undefined;
        set({
          approval: pending ? undefined : s.approval,
          approvals: [
            ...s.approvals,
            {
              requestId: message.requestId,
              decision: message.decision,
              ...(pending ? { step: pending.step, describe: pending.describe } : {}),
            },
          ],
        });
        return;
      }
    }
  },
}));
