// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Launches the built desktop app for e2e tests: hidden window, temp userData, no real keyring needed.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, type Page } from "@playwright/test";

export const APP_DIR = join(import.meta.dirname, "..");

/** Why the Electron tests cannot run here, or undefined when they can. */
export function skipReason(): string | undefined {
  if (!existsSync(join(APP_DIR, "out", "main", "main.js"))) {
    return "app not built (run `bun run --filter @ghosthand/desktop build`)";
  }
  if (process.platform === "linux") {
    const display = process.env.DISPLAY || process.env.WAYLAND_DISPLAY;
    if (!display) {
      try {
        execFileSync("which", ["xvfb-run"], { stdio: "ignore" });
        return "no display; run under xvfb-run (e.g. xvfb-run -a bun run test:smoke)";
      } catch {
        return "no display and no xvfb-run on this machine";
      }
    }
  }
  return undefined;
}

/**
 * On Linux, X11 (XWayland or xvfb) when available: hidden Wayland windows paint once and then stop, so
 * repeated captures hang. GHOSTHAND_E2E_ARGS overrides.
 */
function electronArgs(): string[] {
  const custom = process.env.GHOSTHAND_E2E_ARGS;
  if (custom !== undefined) return custom.split(" ").filter(Boolean);
  return process.platform === "linux" && process.env.DISPLAY ? ["--ozone-platform=x11"] : [];
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

export async function launchApp(env: Record<string, string> = {}): Promise<LaunchedApp> {
  const userData = mkdtempSync(join(tmpdir(), "ghosthand-e2e-"));
  const electronPath = (await import("electron")).default as unknown as string;
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [...electronArgs(), APP_DIR],
    env: {
      ...process.env,
      GHOSTHAND_USER_DATA: userData,
      GHOSTHAND_HIDE_WINDOW: process.env.GHOSTHAND_SHOW_WINDOW === "1" ? "0" : "1",
      ...env,
    } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page, userData };
}
