// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Smoke: the app boots with the security baseline, the composer renders and lists the testbed tasks
// (served by the engine host), and the renderer has no Node access.
import { expect, test } from "@playwright/test";
import { launchApp, skipReason } from "./launch-app.ts";

const reason = skipReason();
test.skip(reason !== undefined, reason ?? "");

test("opens the composer and lists testbed tasks", async () => {
  const { app, page } = await launchApp();
  try {
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    const tasks = page.getByRole("group", { name: "Testbed task" }).getByRole("radio");
    await expect(tasks.first()).toBeVisible({ timeout: 30_000 });
    expect(await tasks.count()).toBeGreaterThanOrEqual(10);
    await expect(page.getByRole("radio", { name: /^l1-login@/ })).toBeVisible();

    // Renderer isolation: no Node, one bridge object, served from app://.
    const probe = await page.evaluate(() => ({
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      bridge: Object.keys((globalThis as { ghosthand?: object }).ghosthand ?? {}).sort(),
      origin: location.origin,
    }));
    expect(probe.require).toBe("undefined");
    expect(probe.process).toBe("undefined");
    expect(probe.bridge).toEqual(["invoke", "onEngineMessage", "onPush", "platform"]);
    expect(probe.origin).toBe("app://ghosthand");

    // Window security settings as main created them.
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      // Present at run time, missing from electron.d.ts.
      const wc = w?.webContents as unknown as
        | { getLastWebPreferences(): Electron.WebPreferences }
        | undefined;
      const p = wc?.getLastWebPreferences();
      return p
        ? {
            contextIsolation: p.contextIsolation,
            sandbox: p.sandbox,
            nodeIntegration: p.nodeIntegration,
            webviewTag: p.webviewTag,
          }
        : undefined;
    });
    expect(prefs).toEqual({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    });

    // window.open is denied and navigation away is blocked.
    const opened = await page.evaluate(() => window.open("https://example.com") === null);
    expect(opened).toBe(true);
  } finally {
    await app.close();
  }
});

test("rejects malformed IPC from the renderer", async () => {
  const { app, page } = await launchApp();
  try {
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    const r = await page.evaluate(async () => {
      const g = (globalThis as unknown as { ghosthand: { invoke(c: string, i?: unknown): Promise<unknown> } })
        .ghosthand;
      return Promise.all([
        g.invoke("runs.get", { runId: "../../etc/passwd" }),
        g.invoke("nope"),
        g.invoke("shell.openExternal", { url: "file:///etc/passwd" }),
        g.invoke("secrets.list"),
      ]);
    });
    expect(r[0]).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(r[1]).toMatchObject({ ok: false, error: { kind: "unknown_command" } });
    expect(r[2]).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(r[3]).toMatchObject({ ok: true, value: { names: [] } });
  } finally {
    await app.close();
  }
});
