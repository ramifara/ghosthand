// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// End to end against the running testbed (`bun run dev:testbed`): plumbing mode (heuristic decisions, no
// key, no network beyond 127.0.0.1), l1-login from the composer, live view with screencast, takeover and
// resume, the step tape, and the replay viewer. Skipped unless the testbed answers on :4401.
// GHOSTHAND_CAPTURE_DIR=<dir> also saves the screenshots used in docs/reports/phase-2-screens.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { launchApp, skipReason } from "./launch-app.ts";

async function testbedUp(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:4401/state", { signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch {
    return false;
  }
}

const reason = skipReason() ?? ((await testbedUp()) ? undefined : "testbed is not running on 127.0.0.1:4401");
test.skip(reason !== undefined, reason ?? "");

const captureDir = process.env.GHOSTHAND_CAPTURE_DIR;
/** Hidden windows do not produce frames for page.screenshot; capturePage paints them on demand. */
async function capture(app: ElectronApplication, name: string): Promise<void> {
  if (!captureDir) return;
  mkdirSync(captureDir, { recursive: true });
  // A hidden window hands back its previous frame: capture once to force a paint, then keep the second.
  const grab = () =>
    app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w?.webContents.invalidate();
      const img = await w?.webContents.capturePage();
      return img?.resize({ width: 1100, quality: "good" }).toPNG().toString("base64") ?? "";
    });
  await grab();
  await new Promise((r) => setTimeout(r, 400));
  const b64 = await grab();
  writeFileSync(join(captureDir, `${name}.png`), Buffer.from(b64, "base64"));
}

test("runs l1-login in plumbing mode with live view, takeover and replay", async () => {
  const { app, page } = await launchApp();
  try {
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    await page.evaluate(async () => {
      const g = (globalThis as unknown as { ghosthand: { invoke(c: string, i?: unknown): Promise<unknown> } })
        .ghosthand;
      await g.invoke("settings.set", { devPlumbingMode: true, showBrowser: false });
    });
    await page.reload();
    await page.getByRole("radio", { name: /^l1-login@/ }).click({ force: true });
    await expect(page.getByLabel("Decision")).toHaveValue("heuristic");
    await capture(app, "composer");

    await page.getByRole("button", { name: "Start run" }).click({ force: true });
    await expect(page.getByRole("button", { name: /Take over/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByAltText("Live view of the agent's browser")).toBeVisible({ timeout: 30_000 });

    // Take over as soon as the first step shows, then hand back.
    await expect(page.getByRole("list", { name: "Steps" }).getByRole("listitem").first()).toBeVisible({
      timeout: 30_000,
    });
    const takeOver = page.getByRole("button", { name: /Take over/ });
    if (await takeOver.isVisible()) {
      await takeOver.click({ force: true });
      const resume = page.getByRole("button", { name: /Resume agent/ });
      const paused = await resume.waitFor({ state: "visible", timeout: 5_000 }).then(
        () => true,
        () => false,
      );
      if (paused) {
        await expect(page.getByText("You have control · the agent is paused")).toBeVisible();
        await capture(app, "live-takeover");
        await resume.click({ force: true });
      }
    }

    await expect(page.getByRole("button", { name: "Open replay" })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/oracle pass/)).toBeVisible();
    await capture(app, "live");

    // Expand the "press Sign in" step to show every Jev head and the gates.
    await page.getByRole("button", { name: "Step 3 details" }).click({ force: true });
    await capture(app, "timeline");

    await page.getByRole("button", { name: "Open replay" }).click({ force: true });
    await expect(page.getByText("replay", { exact: true })).toBeVisible();
    await expect(page.getByAltText("Live view of the agent's browser")).toBeVisible({ timeout: 15_000 });
    await capture(app, "replay");

    await page.getByRole("link", { name: /Runs/ }).click({ force: true });
    await expect(page.getByRole("button", { name: /Open run/ }).first()).toBeVisible();
    await capture(app, "runs");

    await page.getByRole("link", { name: /Setup/ }).click({ force: true });
    await page.getByRole("tab", { name: "Models" }).click({ force: true });
    await expect(page.getByText("Vision grounder")).toBeVisible();
    await capture(app, "settings-models");

    // Device theme: the same replay in dark.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goBack();
    await page.goBack();
    await expect(page.getByText("replay", { exact: true })).toBeVisible();
    await capture(app, "replay-dark");
  } finally {
    await app.close();
  }
});
