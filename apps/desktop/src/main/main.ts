// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Electron main: a thin broker. It owns the window, settings, secrets (safeStorage) and ChatGPT sign-in,
// validates every renderer call, and forwards engine work to the engine host utilityProcess. Run events
// and screencast frames flow host → renderer over a MessagePort without passing through here.
import { join } from "node:path";
import {
  IPC_INVOKE_CHANNEL,
  IPC_PORT_CHANNEL,
  IPC_PUSH_CHANNEL,
  type PushMessage,
} from "@ghosthand/protocol";
import {
  app,
  type BrowserWindow,
  ipcMain,
  MessageChannelMain,
  safeStorage,
  session,
  shell,
  utilityProcess,
} from "electron";
import { handleAppProtocol, registerAppScheme } from "./app-protocol.ts";
import { ChatGptAuth } from "./chatgpt/chatgpt-auth.ts";
import { EngineHostClient } from "./engine-host-client.ts";
import { isAllowedExternalUrl } from "./external-links.ts";
import { createIpcRouter } from "./ipc-router.ts";
import { createMainHandlers } from "./main-handlers.ts";
import { SecretStore } from "./secret-store.ts";
import { hardenSession, hardenWebContents } from "./security.ts";
import { APP_ORIGIN, type SenderPolicy } from "./sender-guard.ts";
import { SettingsStore } from "./settings-store.ts";
import { TakeoverHotkey } from "./takeover-hotkey.ts";
import { createMainWindow } from "./window.ts";

const here = import.meta.dirname;
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const policy: SenderPolicy = devUrl ? { devOrigin: new URL(devUrl).origin } : {};

// userData: "GhostHand" rather than the npm scope path; tests point it at a temp dir.
app.setName("GhostHand");
app.setPath("userData", process.env.GHOSTHAND_USER_DATA ?? join(app.getPath("appData"), "GhostHand"));
app.enableSandbox();
registerAppScheme();

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | undefined;

function push(message: PushMessage): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC_PUSH_CHANNEL, message);
}

function openExternal(url: string): Promise<void> {
  return shell.openExternal(url);
}

async function main(): Promise<void> {
  await app.whenReady();
  const userData = app.getPath("userData");
  const settings = new SettingsStore(join(userData, "settings.json"));
  const persistWithoutKeyring = settings.get().persistWithoutKeyring;
  const secrets = new SecretStore({
    file: join(userData, "secrets.json"),
    safeStorage,
    platform: process.platform,
    persistWithoutKeyring,
  });
  const chatgptStore = new SecretStore({
    file: join(userData, "chatgpt-auth.json"),
    safeStorage,
    platform: process.platform,
    persistWithoutKeyring,
  });
  const chatgpt = new ChatGptAuth({
    store: chatgptStore,
    hostIdFile: join(userData, "agent-host-id"),
    openExternal,
    fetch: (input, init) => fetch(input, init),
    isEnabled: () => settings.get().chatgptSignIn,
    onStatus: (status) => push({ kind: "chatgpt", status }),
  });

  const connectRenderer = () => {
    if (!win || win.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    host.sendPort(port1);
    win.webContents.postMessage(IPC_PORT_CHANNEL, null, [port2]);
  };

  const hotkey = new TakeoverHotkey(() => {
    void host.request("runs.toggleTakeover", {});
  });

  const host = new EngineHostClient({
    spawn: () =>
      utilityProcess.fork(join(here, "engine-host.js"), [], {
        serviceName: "ghosthand-engine",
        stdio: "inherit",
        env: { ...process.env, GHOSTHAND_APP_VERSION: app.getVersion() },
      }),
    onReady: () => {
      push({ kind: "engine", state: "ready" });
      connectRenderer();
    },
    onExit: (code, willRestart) => {
      console.warn(`engine host exited with code ${code}${willRestart ? "; restarting" : ""}`);
      hotkey.release();
      push({ kind: "engine", state: willRestart ? "restarting" : "crashed" });
    },
    onNotice: (notice) => {
      if (notice.kind !== "run.status") return;
      if (notice.status === "ended") hotkey.release();
      else hotkey.activate();
    },
  });

  const router = createIpcRouter({
    policy,
    handlers: createMainHandlers({
      settings,
      secrets,
      host,
      chatgpt,
      openExternal,
      app: { version: app.getVersion(), platform: process.platform, electron: process.versions.electron },
      onRunStarted: () => hotkey.activate(),
    }),
    onProblem: (p) => console.warn(`ipc ${p.command}: ${p.kind}: ${p.message}`),
  });
  ipcMain.handle(IPC_INVOKE_CHANNEL, (event, command: unknown, input: unknown) => {
    const frame = event.senderFrame;
    return router.handle(
      { url: frame?.url, isMainFrame: frame !== null && frame.parent === null },
      command,
      input,
    );
  });

  hardenSession(session.defaultSession, policy);
  app.on("web-contents-created", (_event, contents) => {
    hardenWebContents(contents, policy, (url) => {
      if (isAllowedExternalUrl(url)) void openExternal(url);
    });
  });
  if (!devUrl) handleAppProtocol(join(here, "../renderer"));

  host.start();
  win = createMainWindow({
    preload: join(here, "../preload/preload.cjs"),
    url: devUrl ?? `${APP_ORIGIN}/index.html`,
    hidden: process.env.GHOSTHAND_HIDE_WINDOW === "1",
  });
  // Every (re)load gets a fresh port; the host replaces its old one.
  win.webContents.on("did-finish-load", connectRenderer);
  win.on("closed", () => {
    win = undefined;
  });

  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on("will-quit", () => {
    hotkey.release();
    host.stop();
  });
  app.on("window-all-closed", () => app.quit());
}

void main();
