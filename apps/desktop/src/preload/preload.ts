// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Sandboxed preload, bundled to one CJS file. Exposes a single `window.ghosthand` object: a typed
// `invoke`, and subscriptions for engine messages (MessagePort from the engine host) and main pushes.
// Raw ipcRenderer, ports and Node APIs are never exposed.
import type { GhostHandBridge, IpcCommandName } from "@ghosthand/protocol";
import { contextBridge, ipcRenderer } from "electron";

// Channel names are duplicated from @ghosthand/protocol so the preload bundle stays free of zod.
const INVOKE = "ghosthand:invoke";
const PORT = "ghosthand:engine-port";
const PUSH = "ghosthand:push";

type Listener = (message: unknown) => void;
const engineListeners = new Set<Listener>();
const pushListeners = new Set<Listener>();
let port: MessagePort | undefined;

ipcRenderer.on(PORT, (event) => {
  port?.close();
  const next = event.ports[0];
  if (!next) return;
  port = next;
  next.onmessage = (m: MessageEvent<unknown>) => {
    for (const l of engineListeners) l(m.data);
  };
  next.start();
});

ipcRenderer.on(PUSH, (_event, message: unknown) => {
  for (const l of pushListeners) l(message);
});

const bridge: GhostHandBridge = {
  invoke: (command: IpcCommandName, input?: unknown) => ipcRenderer.invoke(INVOKE, command, input),
  onEngineMessage(listener) {
    engineListeners.add(listener);
    return () => engineListeners.delete(listener);
  },
  onPush(listener) {
    pushListeners.add(listener);
    return () => pushListeners.delete(listener);
  },
  platform: process.platform,
} as GhostHandBridge;

contextBridge.exposeInMainWorld("ghosthand", bridge);
