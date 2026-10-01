// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The one app window. Every security-relevant webPreference is set explicitly, even where it matches the
// default, so a future Electron default change cannot weaken it.
import { BrowserWindow, nativeTheme } from "electron";

export interface WindowOptions {
  preload: string;
  url: string;
  /** Keep the window hidden (smoke tests and screenshots). */
  hidden: boolean;
}

export function createMainWindow(opts: WindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: "GhostHand",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111416" : "#f6f5f1",
    autoHideMenuBar: true,
    webPreferences: {
      preload: opts.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      safeDialogs: true,
      // A hidden test window must keep painting for captures; a visible one may throttle normally.
      backgroundThrottling: !opts.hidden,
    },
    // Hidden windows still paint so tests can capture them.
    paintWhenInitiallyHidden: true,
  });
  if (!opts.hidden) win.once("ready-to-show", () => win.show());
  void win.loadURL(opts.url);
  return win;
}
