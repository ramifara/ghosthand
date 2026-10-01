// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Ctrl+Shift+Space toggles takeover. While a run is active the shortcut is registered globally (the user
// is usually in the agent's browser window, not ours); it is released as soon as the run ends so we do
// not hold a system-wide key otherwise. The renderer also handles the key when the app has focus.
import { globalShortcut } from "electron";

export const TAKEOVER_ACCELERATOR = "CommandOrControl+Shift+Space";

export class TakeoverHotkey {
  readonly #onPress: () => void;
  #registered = false;

  constructor(onPress: () => void) {
    this.#onPress = onPress;
  }

  activate(): void {
    if (this.#registered) return;
    // Registration fails when another app owns the key; the in-app button and key still work.
    this.#registered = globalShortcut.register(TAKEOVER_ACCELERATOR, this.#onPress);
  }

  release(): void {
    if (!this.#registered) return;
    globalShortcut.unregister(TAKEOVER_ACCELERATOR);
    this.#registered = false;
  }
}
