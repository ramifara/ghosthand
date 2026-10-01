// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Subscribes to the engine port and main pushes once at startup and routes them to the stores.
import { EngineMessage, PushMessage } from "@ghosthand/protocol";
import type { QueryClient } from "@tanstack/react-query";
import { useLiveStore } from "../stores/live-store.ts";
import { bridge, call } from "./bridge.ts";

export function startEngineStream(queryClient: QueryClient, onHotkey: () => void): () => void {
  const b = bridge();
  const offEngine = b.onEngineMessage((raw) => {
    const parsed = EngineMessage.safeParse(raw);
    if (!parsed.success) return;
    useLiveStore.getState().ingest(parsed.data);
    if (parsed.data.kind === "status" && parsed.data.status === "ended") {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    }
  });
  const offPush = b.onPush((raw) => {
    const parsed = PushMessage.safeParse(raw);
    if (!parsed.success) return;
    const m = parsed.data;
    if (m.kind === "engine") useLiveStore.getState().setEngine(m.state);
    else if (m.kind === "chatgpt") queryClient.setQueryData(["chatgpt"], m.status);
    else if (m.kind === "hotkey") onHotkey();
  });
  // Re-attach to a run that was already going (window reload).
  void call("runs.active", {})
    .then((active) => {
      if (active && active.status !== "ended") {
        useLiveStore.setState({ runId: active.runId, status: active.status });
      }
    })
    .catch(() => {});
  return () => {
    offEngine();
    offPush();
  };
}

/** Toggle takeover on the live run (button, in-app key and global hotkey share this). */
export async function toggleTakeover(): Promise<void> {
  const { runId, status } = useLiveStore.getState();
  if (!runId || status === "ended" || status === undefined) return;
  if (status === "paused") await call("runs.resume", { runId });
  else await call("runs.takeover", { runId });
}
