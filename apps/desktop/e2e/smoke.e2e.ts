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

test("saves browser behavior through the settings UI and rejects invalid timezones", async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByRole("link", { name: "Setup" }).click();
    await page.getByRole("tab", { name: "Browser", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Web browser behavior" })).toBeVisible();
    await page.getByRole("switch", { name: "Reduce automation markers", exact: true }).click();
    await page.getByRole("switch", { name: "Human-like input", exact: true }).click();
    await page.getByRole("switch", { name: "Use native window size", exact: true }).click();
    await page.getByLabel("Language", { exact: true }).fill("de-DE");
    await page.getByLabel("Timezone", { exact: true }).fill("Europe/Berlin");
    await page.getByLabel("Proxy server", { exact: true }).fill("http://draft-proxy.test:8080");
    await page.getByRole("button", { name: "Save browser behavior" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    await expect(page.getByLabel("Proxy server", { exact: true })).toHaveValue(
      "http://draft-proxy.test:8080",
    );
    const stored = await page.evaluate(async () => {
      const g = (globalThis as unknown as { ghosthand: { invoke(c: string, i?: unknown): Promise<unknown> } })
        .ghosthand;
      return g.invoke("settings.get", {});
    });
    expect(stored).toMatchObject({
      ok: true,
      value: {
        browserBehavior: {
          reduceAutomationMarkers: true,
          nativeWindow: true,
          inputPacing: "human",
          locale: "de-DE",
          timezoneId: "Europe/Berlin",
        },
      },
    });
    await page.getByLabel("Timezone", { exact: true }).fill("Mars/Olympus");
    await page.getByRole("button", { name: "Save browser behavior" }).click();
    await expect(page.getByRole("alert")).toContainText("expected a timezone");
    await page.getByRole("tab", { name: "Profiles", exact: true }).click();
    await page.getByRole("tab", { name: "Browser", exact: true }).click();
    await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue("Mars/Olympus");
    await page.getByRole("button", { name: "Reset browser behavior fields" }).click();
    await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue("Europe/Berlin");
  } finally {
    await app.close();
  }
});

test("saves optional proxy and external FlareSolverr settings with credential names", async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByRole("link", { name: "Setup" }).click();
    await page.getByRole("tab", { name: "Browser", exact: true }).click();
    await page.getByRole("switch", { name: "Use a browser proxy", exact: true }).click();
    await page.getByLabel("Proxy server", { exact: true }).fill("http://proxy.test:8080");
    await page.getByLabel("Proxy username credential").fill("PROXY_USER");
    await page.getByLabel("Proxy password credential").fill("PROXY_PASSWORD");
    await page.getByRole("switch", { name: "Prepare sessions with FlareSolverr", exact: true }).click();
    await page.getByRole("button", { name: "Save proxy and FlareSolverr" }).click();
    await expect(page.getByRole("alert")).toHaveText("add at least one FlareSolverr origin");
    await page.getByLabel("FlareSolverr endpoint", { exact: true }).fill("https://solver.test/prefix");
    await page
      .getByLabel("FlareSolverr origins", { exact: true })
      .fill("https://app.test\nhttps://www.app.test");
    await page.getByLabel("Service bearer credential").fill("SOLVER_TOKEN");
    await page.getByLabel("Preparation timeout in seconds").fill("45");
    await page.getByLabel("Language", { exact: true }).fill("fr-FR");
    await page.getByRole("button", { name: "Save proxy and FlareSolverr" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    await expect(page.getByLabel("Language", { exact: true })).toHaveValue("fr-FR");
    const stored = await page.evaluate(async () => {
      const g = (globalThis as unknown as { ghosthand: { invoke(c: string, i?: unknown): Promise<unknown> } })
        .ghosthand;
      return g.invoke("settings.get", {});
    });
    expect(stored).toMatchObject({
      ok: true,
      value: {
        browserNetwork: {
          proxy: {
            enabled: true,
            server: "http://proxy.test:8080",
            usernameSecretRef: "PROXY_USER",
            passwordSecretRef: "PROXY_PASSWORD",
          },
          flaresolverr: {
            enabled: true,
            endpoint: "https://solver.test/prefix",
            origins: ["https://app.test", "https://www.app.test"],
            bearerSecretRef: "SOLVER_TOKEN",
            timeoutMs: 45000,
          },
        },
      },
    });
    await page.getByRole("tab", { name: "Profiles", exact: true }).click();
    await page.getByRole("tab", { name: "Browser", exact: true }).click();
    await expect(page.getByLabel("Proxy password credential")).toHaveValue("PROXY_PASSWORD");
    await expect(page.getByLabel("FlareSolverr endpoint", { exact: true })).toHaveValue(
      "https://solver.test/prefix",
    );
  } finally {
    await app.close();
  }
});
